"""Actual native tools on synthetic scanned documents and composed slides."""
import io
from pathlib import Path
import sys
import unittest
import zipfile

import pypdfium2 as pdfium
from PIL import Image
sys.path.insert(0, "/opt")
from document_visuals import render_pdf, DocumentVisualError
from document_native import presentation_pdf, ocr_page, parse_tsv

FIXTURES = Path("/fixtures")


class NativeDocumentTests(unittest.TestCase):
    def test_scanned_pdf_has_no_text_but_real_ocr_recovers_brand_lines(self):
        source = (FIXTURES / "scanned-guidelines.pdf").read_bytes()
        document = pdfium.PdfDocument(source)
        page = document[0]
        text = page.get_textpage()
        self.assertEqual(text.get_text_range().strip(), "")
        text.close(); page.close(); document.close()
        visual = next(render_pdf(source))
        lines = ocr_page(visual["bytes"], visual["width"], visual["height"])
        combined = "\n".join(line["text"] for line in lines)
        self.assertIn("Olive and Field", combined)
        self.assertIn("Botanical soap", combined)
        self.assertIn("REFILL", combined)
        for line in lines:
            self.assertGreaterEqual(line["confidence"], 0)
            self.assertLessEqual(line["bbox"]["r"], visual["width"])
            self.assertEqual(line["language"], "eng")

    def test_full_slide_conversion_includes_hidden_slide_and_picture(self):
        pdf = presentation_pdf((FIXTURES / "composed-guidelines.pptx").read_bytes())
        pages = list(render_pdf(pdf))
        self.assertEqual(len(pages), 2)
        with Image.open(io.BytesIO(pages[0]["bytes"])) as image:
            r, g, b = image.getpixel((image.width-20, image.height-20))
            self.assertGreater(b, r+100)
        text = "\n".join(line["text"] for line in ocr_page(pages[0]["bytes"], pages[0]["width"], pages[0]["height"]))
        self.assertIn("Olive", text)
        self.assertIn("Botanical", text)

    def test_external_media_fails_before_conversion(self):
        source = zipfile.ZipFile(FIXTURES / "guidelines.pptx")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for name in source.namelist():
                archive.writestr(name, source.read(name))
            archive.writestr("ppt/_rels/external.rels", '<Relationships><Relationship TargetMode="External" Type="image" Target="http://169.254.169.254/secret"/></Relationships>')
        source.close()
        with self.assertRaisesRegex(DocumentVisualError, "EXTERNAL_RESOURCE"):
            presentation_pdf(output.getvalue())

    def test_invalid_ocr_rows_fail_closed(self):
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        for text in ["", "wrong\n", header + "5\t1\t1\t1\t1\t1\t0\t0\t5\t5\tnan\ttest\n",
            header + "5\t1\t1\t1\t1\t1\t99\t0\t5\t5\t90\ttest\n"]:
            with self.subTest(text=text), self.assertRaises(DocumentVisualError):
                parse_tsv(text, 100, 100)


if __name__ == "__main__":
    unittest.main()
