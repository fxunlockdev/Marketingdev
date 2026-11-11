import unittest
import tempfile
from pathlib import Path
from scripts.production_rules_audit import inspect_production_rules, TASK_REFERENCES

class ProductionRulesTests(unittest.TestCase):
    def test_each_task_gets_exact_references_and_no_client_worlds(self):
        pins=[]
        for task,refs in TASK_REFERENCES.items():
            pin,files=inspect_production_rules(task)
            pins.append(pin)
            self.assertEqual(set(files), {'/skills/desvio-production/SKILL.md',
                *[f'/skills/desvio-production/references/{ref}.md' for ref in refs]})
        self.assertTrue(all(p==pins[0] for p in pins))
        _,analysis=inspect_production_rules('insights')
        self.assertFalse(any('creative-style' in p for p in analysis))
        _,video=inspect_production_rules('video')
        self.assertFalse(any('logo-design' in p for p in video))

    def test_optional_private_source_is_absent_from_shared_rules(self):
        scoped=Path(__file__).resolve().parents[2]/'inputs/desvio-scoped-rules'
        sources=list(scoped.glob('*.md'))
        if not sources:
            self.skipTest('Private client source files are not distributed with this checkout')
        private_lines=[line for p in sources for line in p.read_text().splitlines()
                       if line.startswith('- ') and len(line)>200]
        self.assertTrue(private_lines, 'Private sources exist but no audit statements were identified')
        for task in TASK_REFERENCES:
            _,files=inspect_production_rules(task)
            content=b'\n'.join(files.values()).decode()
            for private in private_lines:
                self.assertNotIn(private,content)

    def test_bad_task_and_mutated_archive_are_rejected(self):
        with self.assertRaisesRegex(ValueError,'SKILL_TASK_DENIED'):
            inspect_production_rules('../../private')
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'modified.zip';path.write_bytes(b'modified')
            with self.assertRaisesRegex(ValueError,'SKILL_DIGEST_MISMATCH'):
                inspect_production_rules('video',path)
