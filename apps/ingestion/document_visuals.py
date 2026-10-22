"""Bounded PDF page evidence, for use inside the isolated ingestion runtime.

This component does not claim OCR, complete slide conversion or model analysis.
The caller must consume every page successfully before committing evidence.
Native PDF parsing still requires the existing network-disabled sandbox.
"""
import hashlib
import io
import math

import pypdfium2 as pdfium

MAX_INPUT = 20 * 1024 * 1024
MAX_PAGES = 50
MAX_EDGE = 2000
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 24 * 1024 * 1024
VERSION = "pdfium-5.14.0/desvio-page-v1"


class DocumentVisualError(ValueError):
    pass


def render_pdf(data):
    """Yield complete, uncropped RGB JPEG pages with immutable provenance.

    Pixel dimensions are bounded before native allocation. Pages are released
    individually, avoiding a document-sized decoded-image allocation. No form
    environment or JavaScript execution is initialized.
    """
    if not isinstance(data, bytes) or not data or len(data) > MAX_INPUT:
        raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
    document = None
    try:
        document = pdfium.PdfDocument(data)
        count = len(document)
        if not 1 <= count <= MAX_PAGES:
            raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
        source_sha = hashlib.sha256(data).hexdigest()
        total = 0
        for index in range(count):
            page = document[index]
            bitmap = None
            image = None
            try:
                width, height = page.get_size()
                if not all(math.isfinite(n) and 0 < n <= 14400 for n in (width, height)):
                    raise DocumentVisualError("DOCUMENT_PAGE_DIMENSIONS_INVALID")
                scale = min(2, MAX_EDGE / max(width, height))
                bitmap = page.render(scale=scale, may_draw_forms=False, draw_annots=True)
                image = bitmap.to_pil().convert("RGB")
                if max(image.size) > MAX_EDGE or min(image.size) < 1:
                    raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=85)
                encoded = output.getvalue()
                total += len(encoded)
                if len(encoded) > MAX_IMAGE_BYTES or total > MAX_TOTAL_BYTES:
                    raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
                evidence = {
                    "version": VERSION, "sourceSha256": source_sha,
                    "page": index + 1, "pages": count,
                    "width": image.width, "height": image.height,
                    "pageWidth": width, "pageHeight": height,
                    "mimeType": "image/jpeg", "sha256": hashlib.sha256(encoded).hexdigest(),
                    "coverage": "rendered_page_without_interactive_forms", "bytes": encoded,
                }
            finally:
                if image is not None:
                    image.close()
                if bitmap is not None:
                    bitmap.close()
                page.close()
            yield evidence
    except DocumentVisualError:
        raise
    except Exception:
        raise DocumentVisualError("DOCUMENT_RENDER_FAILED") from None
    finally:
        if document is not None:
            document.close()
