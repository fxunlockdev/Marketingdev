"""Verify the archive trust boundary without running a package tool."""
import json
from pathlib import Path
import tempfile
import unittest
import importlib.util

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('video_bundle', ROOT/'scripts/prepare-video-bundle.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class VideoBundleGuard(unittest.TestCase):
    def test_changed_package_is_rejected_before_extraction_and_existing_output_is_preserved(self):
        pins=json.loads((ROOT/'apps/video/debian-arm64-packages.json').read_text())
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);cache=root/'cache';cache.mkdir();output=root/'output'
            (cache/pins[0]['filename']).write_bytes(b'not a trusted Debian archive')
            with self.assertRaisesRegex(ValueError,'digest mismatch'):
                module.prepare(cache,output)
            self.assertFalse(output.exists())
            output.mkdir();sentinel=output/'keep';sentinel.write_text('preserve')
            with self.assertRaisesRegex(ValueError,'new directory'):
                module.prepare(cache,output)
            self.assertEqual(sentinel.read_text(),'preserve')
