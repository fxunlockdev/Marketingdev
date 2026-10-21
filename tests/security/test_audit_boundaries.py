import hashlib
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.skill_audit import ROOT, inspect_archive
from scripts.skill_probe import make_mount


class AuditBoundaryTests(unittest.TestCase):
    def test_checksum_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, "checksum"):
            inspect_archive(ROOT / "inputs/marketingskills-main.zip", "0" * 64)

    def test_traversal_and_symlink_rejected(self):
        for name, mode in [("../escape", 0), ("marketingskills-main/escape", 0o120777)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "bad.zip"
                with zipfile.ZipFile(path, "w") as z:
                    info = zipfile.ZipInfo(name)
                    info.external_attr = mode << 16
                    z.writestr(info, b"target")
                with self.assertRaises(ValueError):
                    inspect_archive(path, hashlib.sha256(path.read_bytes()).hexdigest())

    def test_run_mounts_do_not_share_brand_context(self):
        a, b = make_mount("PRIVATE_A"), make_mount("PRIVATE_B")
        key = "/.agents/product-marketing.md"
        self.assertEqual(a.download_files([key])[0].content, b"PRIVATE_A")
        self.assertEqual(b.download_files([key])[0].content, b"PRIVATE_B")
        for p in ["/tenants/b/.agents/product-marketing.md", "/etc/passwd", "/skills/social/../../.env", "/tools/clis/openai.js"]:
            self.assertEqual(a.download_files([p])[0].error, "permission_denied")
        self.assertFalse(hasattr(a, "execute"))


if __name__ == "__main__":
    unittest.main()
