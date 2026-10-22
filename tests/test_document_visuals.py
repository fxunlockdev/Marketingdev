"""Real PDFium rendering of explicitly synthetic document fixtures."""
import hashlib
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps/ingestion"))
from document_visuals import DocumentVisualError, render_pdf


class DocumentVisualTests(unittest.TestCase):
    def fixture(self, name):
        return (ROOT / "work/document-fixtures" / name).read_bytes()

    def test_real_pages_have_exact_provenance_and_decodable_pixels(self):
        source = self.fixture("guidelines.pdf")
        pages = list(render_pdf(source))
        self.assertEqual([p["page"] for p in pages], [1, 2])
        for page in pages:
            self.assertEqual(page["sourceSha256"], hashlib.sha256(source).hexdigest())
            self.assertEqual(page["sha256"], hashlib.sha256(page["bytes"]).hexdigest())
            with Image.open(io.BytesIO(page["bytes"])) as image:
                self.assertEqual(image.size, (page["width"], page["height"]))
                self.assertEqual(image.format, "JPEG")
                self.assertLessEqual(max(image.size), 2000)
                self.assertLess(min(image.convert("L").getextrema()), 100)

    def test_page_without_text_is_rendered_not_rejected(self):
        pages = list(render_pdf(self.fixture("no-text.pdf")))
        self.assertEqual(len(pages), 1)
        with Image.open(io.BytesIO(pages[0]["bytes"])) as image:
            self.assertEqual(image.convert("L").getextrema(), (0, 255))

    def test_fifty_pages_keep_page_identity(self):
        numbers = [page["page"] for page in render_pdf(self.fixture("fifty-pages.pdf"))]
        self.assertEqual(numbers, list(range(1, 51)))

    def test_invalid_or_excessive_input_is_rejected(self):
        for data in (b"", b"not a PDF", b"x" * (20 * 1024 * 1024 + 1)):
            with self.subTest(size=len(data)), self.assertRaises(DocumentVisualError):
                list(render_pdf(data))

    def test_output_budget_fails_instead_of_truncating(self):
        source = self.fixture("guidelines.pdf")
        first = next(render_pdf(source))
        with patch("document_visuals.MAX_TOTAL_BYTES", len(first["bytes"])):
            iterator = render_pdf(source)
            self.assertEqual(next(iterator)["page"], 1)
            with self.assertRaisesRegex(DocumentVisualError, "DOCUMENT_LIMIT_EXCEEDED"):
                next(iterator)

    def test_page_limit_fails_before_emitting_partial_document(self):
        with patch("document_visuals.MAX_PAGES", 1):
            with self.assertRaisesRegex(DocumentVisualError, "DOCUMENT_LIMIT_EXCEEDED"):
                next(render_pdf(self.fixture("guidelines.pdf")))


if __name__ == "__main__":
    unittest.main()
