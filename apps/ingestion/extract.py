"""Bounded Docling extraction. Untrusted bytes in; source evidence JSON out.

Run in a network-disabled, read-only, non-root, resource-limited container.
No application/database/provider credentials enter this process.
"""
import hashlib
import base64
import io
import json
import logging
import sys
import resource
import signal
import warnings
import zipfile
from pathlib import PurePosixPath
from importlib.metadata import version

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 50
MAX_TEXT = 250_000
PARSER_VERSION = "docling-native-2.141.0/tesseract-5.5.0/desvio-v3"


def fail(code):
    print(json.dumps({"error": code}), flush=True)
    raise SystemExit(2)


def validate_archive(data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
                fail("DOCUMENT_LIMIT_EXCEEDED")
            seen = set()
            for entry in entries:
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in entry.filename or entry.filename in seen or entry.flag_bits & 1:
                    fail("UNSAFE_PRESENTATION")
                if entry.file_size > MAX_BYTES or entry.file_size > max(entry.compress_size, 1) * 200:
                    fail("DOCUMENT_LIMIT_EXCEEDED")
                if "vbaproject" in entry.filename.lower() or ((entry.external_attr >> 16) & 0xF000) == 0xA000:
                    fail("UNSAFE_PRESENTATION")
                seen.add(entry.filename)
            slides = [n for n in seen if n.startswith("ppt/slides/slide") and n.endswith(".xml") and "/_rels/" not in n]
            if not slides or len(slides) > MAX_PAGES:
                fail("DOCUMENT_LIMIT_EXCEEDED")
    except zipfile.BadZipFile:
        fail("INVALID_PRESENTATION")


def main():
    resource.setrlimit(resource.RLIMIT_CPU, (90, 91))
    signal.alarm(110)
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings("ignore")
    kind = sys.argv[1] if len(sys.argv) == 2 else ""
    if kind == "website":
        from website import main as website_main
        website_main()
        return
    if kind not in ("pdf", "pptx"):
        fail("UNSUPPORTED_DOCUMENT")
    data = sys.stdin.buffer.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES:
        fail("DOCUMENT_LIMIT_EXCEEDED")
    if kind == "pptx":
        validate_archive(data)
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import NativePdfPipelineOptions
    from docling.document_converter import DocumentConverter, NativePdfFormatOption
    options = NativePdfPipelineOptions(parser_threads=1, document_timeout=90, generate_page_images=False, generate_picture_images=False,
                                       enable_remote_services=False, allow_external_plugins=False)
    converter = DocumentConverter(allowed_formats=[InputFormat.PDF, InputFormat.PPTX], format_options={InputFormat.PDF: NativePdfFormatOption(pipeline_options=options)})
    result = converter.convert(DocumentStream(name=f"document.{kind}", stream=io.BytesIO(data)), max_num_pages=MAX_PAGES, max_file_size=MAX_BYTES, raises_on_error=False)
    if result.status.value != "success":
        fail("DOCUMENT_PARSE_FAILED")
    chunks, size, pages = [], 0, len(result.document.pages)
    for item, _ in result.document.iterate_items():
        text = getattr(item, "text", None)
        if not text or not text.strip():
            continue
        for prov in getattr(item, "prov", []):
            if not 1 <= prov.page_no <= MAX_PAGES:
                fail("INVALID_DOCUMENT_PROVENANCE")
            text = text.strip()
            if len(text) > 12000:
                fail("DOCUMENT_LIMIT_EXCEEDED")
            size += len(text)
            if size > MAX_TEXT or len(chunks) >= 2000:
                fail("DOCUMENT_LIMIT_EXCEEDED")
            chunks.append({"text": text, "page": prov.page_no, "anchor": item.self_ref,
                           "bbox": prov.bbox.model_dump(mode="json")})
    native_pages = {c["page"] for c in chunks}
    ocr_pages = []
    visuals = []
    from document_native import presentation_pdf, ocr_page
    from document_visuals import render_pdf
    rendered = data if kind == "pdf" else presentation_pdf(data)
    for visual in render_pdf(rendered):
        visuals.append({"page": visual["page"], "width": visual["width"], "height": visual["height"],
            "sha256": visual["sha256"], "image": base64.b64encode(visual["bytes"]).decode()})
        if visual["pages"] != pages:
            fail("INVALID_DOCUMENT_PROVENANCE")
        if visual["page"] in native_pages:
            continue
        lines = ocr_page(visual["bytes"], visual["width"], visual["height"])
        if lines:
            ocr_pages.append(visual["page"])
        for index, line in enumerate(lines):
            size += len(line["text"])
            if size > MAX_TEXT or len(chunks) >= 2000 or len(line["text"]) > 12000:
                fail("DOCUMENT_LIMIT_EXCEEDED")
            bbox = line["bbox"]
            chunks.append({"text": line["text"], "page": visual["page"],
                "anchor": f"#/ocr/{visual['page']}/{index}",
                "bbox": {"l": bbox["l"] * visual["pageWidth"] / visual["width"],
                    "r": bbox["r"] * visual["pageWidth"] / visual["width"],
                    "t": bbox["t"] * visual["pageHeight"] / visual["height"],
                    "b": bbox["b"] * visual["pageHeight"] / visual["height"],
                    "coord_origin": "TOPLEFT", "method": "ocr_eng", "confidence": line["confidence"]}})
    if not chunks:
        fail("DOCUMENT_NEEDS_OCR_OR_MANUAL_REVIEW")
    covered = sorted({c["page"] for c in chunks})
    print(json.dumps({"parserVersion": PARSER_VERSION, "packages": {"docling-slim": version("docling-slim"), "docling-core": version("docling-core")},
                      "sha256": hashlib.sha256(data).hexdigest(), "pages": pages, "textPages": covered, "kind": kind,
                      "coverage": "embedded_text_with_ocr" if ocr_pages else "embedded_text_only", "ocrPages": ocr_pages,
                      "visuals": visuals, "chunks": chunks}, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        from document_visuals import DocumentVisualError
        fail(str(error) if isinstance(error, DocumentVisualError) else "DOCUMENT_PARSE_FAILED")
