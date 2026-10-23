# 0046 — Explicit native worker architectures

Desvio's developer host is ARM64 while the audited Railway sandbox host is x86_64. Passing the API/web image checks cannot establish compatibility of the isolated document and video runtimes.

Keep the existing Python, FFmpeg, LibreOffice/Tesseract, Deep Agents and Temporal architecture. Add separate amd64 archive manifests acquired through signed official Debian APT. Every archive is hashed before extraction or Docker invocation; runtime downloads remain prohibited. Video archives are extracted without package scripts. Document package installation still runs only during an offline build, returning to the unprivileged runtime user.

`DESVIO_RUNTIME_ARCH=amd64` selects the target explicitly; otherwise build tooling uses the Docker engine architecture. Only arm64/amd64 are supported. Native library paths, cache directories and image tags follow this target. Inspect the resulting image architecture before returning its content digest.

The legacy Docker builder exposed a platform-cache conflict when using the shared Python multi-platform index. `infra/python-runtime-image.json` records the exact amd64 and arm64 child digests obtained from the original pinned official registry index, whose returned bytes matched its SHA-256. Build helpers pass the appropriate child digest, retaining the original Python release rather than updating dependencies to bypass the failure.

Acceptance requires actual restricted-container tests of media decode/render, adapter behavior and PDF/PPTX/OCR components for x86, plus regression on the developer architecture. Synthetic fixtures prove component behavior; they do not prove live provider quality or Railway worker lifecycle. Keep launch blocked until private cloud services, durable worker recovery, tenant isolation and authorized provider acceptance are demonstrated.
