import unittest
from scripts.skill_audit import ROOT, inspect_archive
from scripts.skill_probe import SELECTED, discover, make_mount


class SkillsAuditTests(unittest.TestCase):
    def test_original_archive_and_all_skill_hashes(self):
        report, _ = inspect_archive(ROOT / "inputs/marketingskills-main.zip")
        self.assertEqual(report["skill_count"], 52)
        self.assertEqual(len(set(s["tree_sha256"] for s in report["skills"])), 52)
        self.assertFalse(report["helpers_executed"])

    def test_real_middleware_discovers_curated_subset(self):
        result = discover(make_mount("Approved test brand A"))
        self.assertEqual(sorted(x["name"] for x in result["skills_metadata"]), sorted(SELECTED))
        self.assertFalse(result["skills_load_errors"])

    def test_supporting_references_are_mounted(self):
        mount = make_mount("Approved A")
        refs = [p for p in mount._files if "/references/" in p]
        self.assertTrue(refs)
        self.assertIsNotNone(mount.download_files([refs[0]])[0].content)


if __name__ == "__main__":
    unittest.main()
