"""Native document tools; called only inside the isolated ingestion container.

No untrusted command arguments, URLs or filenames cross this boundary. English
OCR is an explicit initial capability, not a claim of multilingual extraction.
"""
import csv
import contextlib
import io
import json
import math
from pathlib import Path
import resource
import subprocess
import tempfile
import zipfile

from defusedxml import ElementTree
from document_visuals import DocumentVisualError, MAX_INPUT, MAX_EDGE
from extract import validate_archive


def child_limits():
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (35, 36))


def run_native(args, output):
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.DEVNULL,
            timeout=40, check=False, preexec_fn=child_limits,
            env={"PATH": "/usr/bin:/bin", "HOME": "/tmp", "LANG": "C.UTF-8", "OMP_THREAD_LIMIT": "1", "SAL_USE_VCLPLUGIN": "svp"})
        if result.returncode != 0:
            raise DocumentVisualError("DOCUMENT_NATIVE_FAILED")
    except (OSError, subprocess.TimeoutExpired):
        raise DocumentVisualError("DOCUMENT_NATIVE_FAILED") from None


def presentation_pdf(data):
    if not data or len(data) > MAX_INPUT:
        raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            validate_archive(data)
    except SystemExit:
        raise DocumentVisualError("UNSAFE_PRESENTATION") from None
    # External media/OLE and embedded executables cannot be fetched or opened.
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            if entry.filename.startswith("ppt/embeddings/"):
                raise DocumentVisualError("PRESENTATION_EMBEDDED_OBJECT_UNSUPPORTED")
            if entry.filename.endswith(".rels"):
                try:
                    relationships = ElementTree.fromstring(archive.read(entry))
                except Exception:
                    raise DocumentVisualError("UNSAFE_PRESENTATION") from None
                for rel in relationships:
                    if rel.get("TargetMode") == "External" and not rel.get("Type", "").endswith("/hyperlink"):
                        raise DocumentVisualError("PRESENTATION_EXTERNAL_RESOURCE_UNSUPPORTED")
    with tempfile.TemporaryDirectory(prefix="document-") as directory:
        root = Path(directory)
        source = root / "source.pptx"
        source.write_bytes(data)
        profile = root / "profile"
        (profile / "user").mkdir(parents=True)
        (profile / "user/registrymodifications.xcu").write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>''')
        options = {"ExportHiddenSlides": {"type": "boolean", "value": "true"},
            "ExportNotesPages": {"type": "boolean", "value": "false"},
            "ExportFormFields": {"type": "boolean", "value": "false"}}
        run_native(["/usr/bin/libreoffice", f"-env:UserInstallation={profile.as_uri()}", "--headless", "--norestore",
            "--convert-to", "pdf:impress_pdf_Export:" + json.dumps(options), "--outdir", str(root), str(source)], subprocess.DEVNULL)
        result = root / "source.pdf"
        if not result.is_file() or not 0 < result.stat().st_size <= MAX_INPUT:
            raise DocumentVisualError("DOCUMENT_CONVERSION_FAILED")
        return result.read_bytes()


def ocr_page(image_bytes, width, height):
    if not image_bytes or len(image_bytes) > 2 * 1024 * 1024 or not all(isinstance(n, int) and 0 < n <= MAX_EDGE for n in (width, height)):
        raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
    with tempfile.TemporaryDirectory(prefix="ocr-") as directory:
        root = Path(directory)
        source, output = root / "page.jpg", root / "words.tsv"
        source.write_bytes(image_bytes)
        with output.open("wb") as stream:
            run_native(["/usr/bin/tesseract", str(source), "stdout", "-l", "eng", "--oem", "1", "--psm", "3", "tsv"], stream)
        if output.stat().st_size > 2 * 1024 * 1024:
            raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
        return parse_tsv(output.read_text(), width, height)


def parse_tsv(text, width, height):
    """Preserve uncertain words and confidence; human review remains mandatory."""
    lines = {}
    total = 0
    try:
        reader = csv.DictReader(io.StringIO(text), delimiter="\t", quoting=csv.QUOTE_NONE)
        if reader.fieldnames != ["level", "page_num", "block_num", "par_num", "line_num", "word_num", "left", "top", "width", "height", "conf", "text"]:
            raise ValueError("invalid OCR fields")
        for row in reader:
            if row["level"] != "5" or not row["text"].strip():
                continue
            word = row["text"].strip()
            x, y, w, h = [int(row[key]) for key in ("left", "top", "width", "height")]
            confidence = float(row["conf"])
            if not (0 <= x < width and 0 <= y < height and 0 < w <= width-x and 0 < h <= height-y and math.isfinite(confidence) and 0 <= confidence <= 100):
                raise ValueError("invalid OCR provenance")
            total += len(word)
            if total > 25000:
                raise DocumentVisualError("DOCUMENT_LIMIT_EXCEEDED")
            key = tuple(row[k] for k in ("block_num", "par_num", "line_num"))
            lines.setdefault(key, []).append({"text": word, "confidence": confidence, "bbox": [x, y, x+w, y+h]})
        return [{"text": " ".join(w["text"] for w in words), "confidence": min(w["confidence"] for w in words),
            "bbox": {"l": min(w["bbox"][0] for w in words), "t": min(w["bbox"][1] for w in words),
                "r": max(w["bbox"][2] for w in words), "b": max(w["bbox"][3] for w in words), "coord_origin": "TOPLEFT"},
            "words": words, "language": "eng", "method": "tesseract-5.5.0"} for words in lines.values()]
    except (KeyError, TypeError, ValueError) as error:
        if isinstance(error, DocumentVisualError):
            raise
        raise DocumentVisualError("DOCUMENT_OCR_OUTPUT_INVALID") from None
