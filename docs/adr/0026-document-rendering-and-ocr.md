# Document rendering and scanned-page extraction

Status: implementation in progress; Brands & Onboarding remains active. No architecture replacement, paid provider call or launch-readiness claim.

## Customer action

Upload an image-only PDF through the existing authenticated private upload and malware-validation flow. Its existing Temporal extraction job now renders textless pages and runs English OCR. Findings retain page numbers, source hash and OCR confidence; users must review/correct them before the existing immutable Brand Brain approval. The original file remains privately stored.

## Runtime and contracts

- Docling native extraction remains authoritative for embedded text. PDFium 5.14.0 renders bounded uncropped page images (2,000-pixel maximum edge, two MiB per JPEG, 24 MiB total). It does not initialize interactive forms or a JavaScript environment.
- Tesseract 5.5.0 TSV provides word rectangles/confidence. The adapter validates coordinates and finite confidence, groups actual words by line and scales line rectangles back to document coordinates. English-only OCR is explicit. OCR does not create approved facts automatically.
- LibreOffice Impress 25.2.3 converts complete presentations, exporting hidden slides and excluding note pages. Tests check actual text/image composition and hidden-slide count. External media relationships and embedded objects are rejected; conversion does not promise fidelity for unsupported fonts, embedded charts/OLE, animations or interactive content.
- Native tools are installed in a baked child of the exact local ingestion image. All 180 additional ARM64 Debian archives have package/version/architecture/SHA-256 pins. Signed official Debian APT acquisition is build tooling; builds validate archive hashes and disable network while executing package installers. Package installation honors LibreOffice's pre-dependency ordering. Runtime is non-root, read-only, network-disabled and has no credentials, with bounded CPU/memory/processes/tmpfs and outer timeout.
- `scripts/fetch-document-deps.py` obtains exact pins when missing. Removed upstream versions fail closed rather than updating pins. The native image is ARM64 only; cloud architecture/deployment acceptance remains open.
- The document parser version changes to `docling-native-2.141.0/tesseract-5.5.0/desvio-v2`. It reports `embedded_text_only` or `embedded_text_with_ocr` plus exact OCR page numbers. Native text and OCR provenance must agree with the declared coverage. Existing website and document output limits are unchanged.

Primary references: [Tesseract TSV CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html), [LibreOffice PDF export properties](https://help.libreoffice.org/latest/en-US/text/shared/guide/pdf_params.html). Actual pinned PDFium/Docling APIs were also inspected in the installed packages; current documentation alone does not prove older binary behavior.

## Validation

`make verify-document-visuals` builds the image, exercises actual renderer/native tools on synthetic fixtures, then runs the genuine document upload/extraction/review/approval tests with disposable PostgreSQL, private object storage, malware scanner and Temporal. It writes source-bound machine evidence. The image-only fixture has zero embedded PDF text, so finding its brand strings proves OCR occurred. No provider response is used to manufacture these findings.

## Remaining work

Rendering components are not yet saved as private document visual evidence or supplied to the multimodal Brand Analyzer. OCR currently handles pages with no embedded text; text within images on mixed-content pages needs additional coverage. Full slide visuals/typographic fidelity, approved reference selection, unsupported languages, deployment and authorized real AI interpretation remain acceptance gaps. Full regression and live gates stay separate from focused component/integration tests.
