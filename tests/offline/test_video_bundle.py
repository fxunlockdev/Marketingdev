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

    def test_supported_architectures_have_exact_pins_and_same_ffmpeg_contract(self):
        for arch in ['arm64','amd64']:
            pins=json.loads((ROOT/f'apps/video/debian-{arch}-packages.json').read_text())
            self.assertEqual(len(pins),len({p['Package'] for p in pins}))
            self.assertEqual(next(p['Version'] for p in pins if p['Package']=='ffmpeg'),'7:7.1.5-0+deb13u1')
            for pin in pins:
                self.assertIn(pin['Architecture'],[arch,'all'])
                self.assertRegex(pin['sha256'],r'^[a-f0-9]{64}$')
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'Unsupported runtime architecture'):
                module.prepare(Path(folder),Path(folder)/'output','unexpected')
