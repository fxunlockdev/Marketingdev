"""Acquire exact reviewed native archives through signed official Debian APT.

Build tooling only. No customer inputs, application secrets or package scripts.
Unavailable historical versions fail; never silently update the manifest.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
kind = sys.argv[1] if len(sys.argv)>1 else "document"
architecture = sys.argv[2] if len(sys.argv)>2 else "arm64"
if architecture not in {"arm64", "amd64"}:
    raise ValueError("Unsupported runtime architecture")
if kind not in {"document", "video"}:
    raise ValueError("Unsupported native archive set")
pins = json.loads((root / (f"apps/video/debian-{architecture}-packages.json" if kind == "video" else f"apps/ingestion/debian-document-{architecture}-packages.json")).read_text())
packages = []
for pin in pins:
    if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", pin["Package"]) or not re.fullmatch(r"[a-zA-Z0-9+.:~_-]+", pin["Version"]):
        raise ValueError("Invalid package pin")
    packages.append(pin["Package"] + "=" + pin["Version"])
bundle = root / f"work/{kind}-deps-{architecture}"
for name in ["lists", "debs", "log"]:
    (bundle / name).mkdir(parents=True, exist_ok=True)
(bundle / "apt.conf").write_text('''Dir::State::lists "/bundle/lists";
Dir::Cache::archives "/bundle/debs";
Dir::Log "/bundle/log";
Dir::Etc::sourcelist "/bundle/sources.list";
Dir::Etc::sourceparts "-";
Debug::NoLocking "true";
APT::Sandbox::User "root";
Acquire::Languages "none";
''')
(bundle / "sources.list").write_text('''deb [signed-by=/usr/share/keyrings/debian-archive-keyring.pgp] https://deb.debian.org/debian trixie main
deb [signed-by=/usr/share/keyrings/debian-archive-keyring.pgp] https://deb.debian.org/debian-security trixie-security main
''')
subprocess.run(["docker", "run", "--platform", f"linux/{architecture}", "--rm", "--read-only", "--cap-drop=ALL", "--security-opt", "no-new-privileges",
    "--memory", "1g", "--cpus", "1", "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--mount", f"type=bind,src={bundle},dst=/bundle", "--env", "APT_CONFIG=/bundle/apt.conf", "--workdir", "/bundle/debs",
    "--entrypoint", "sh", json.loads((root/"infra/python-runtime-image.json").read_text())["images"][architecture],
    "-c", 'apt-get update && exec apt-get download "$@"', "download-pinned-documents", *packages], check=True, timeout=300)
for pin in pins:
    if hashlib.sha256((bundle / "debs" / pin["filename"]).read_bytes()).hexdigest() != pin["sha256"]:
        raise ValueError("Document archive digest mismatch: " + pin["Package"])
print("Verified", len(pins), f"pinned native {kind} archives")
