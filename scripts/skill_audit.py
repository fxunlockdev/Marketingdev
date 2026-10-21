"""Audit the owner archive as inert data. Never execute bundled helpers."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import re
import stat
import zipfile

import yaml

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_SHA = "68fe5dc3d3c2c4c0f8936ffe305b1bc9f106011a7fbe4a7048920cebe61bf7eb"


def inspect_archive(path, expected_sha=ARCHIVE_SHA):
    raw = Path(path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha:
        raise ValueError("Owner archive checksum mismatch")
    files = {}
    ignored_links = []
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(i.file_size for i in entries) > 100_000_000:
            raise ValueError("Archive exceeds audit budget")
        for info in entries:
            name = info.filename
            p = PurePosixPath(name)
            if p.is_absolute() or ".." in p.parts or "\\" in name or not p.parts or p.parts[0] != "marketingskills-main":
                raise ValueError("Unsafe archive path")
            if stat.S_ISLNK(info.external_attr >> 16):
                if name == "marketingskills-main/CLAUDE.md" and archive.read(info) == b"AGENTS.md":
                    ignored_links.append({"path": name, "target": "AGENTS.md", "mounted": False})
                    continue
                raise ValueError("Archive symlink rejected")
            if info.is_dir():
                continue
            if name in files or info.file_size > 10_000_000 or info.file_size / max(1, info.compress_size) > 200:
                raise ValueError("Unsafe archive member")
            files[name] = archive.read(info)
    prefix = "marketingskills-main/"
    license_text = files[prefix + "LICENSE"].decode()
    if "MIT License" not in license_text or "Corey Haines" not in license_text:
        raise ValueError("Unexpected skills license")
    skills = []
    for name, data in sorted(files.items()):
        if not re.fullmatch(r"marketingskills-main/skills/[a-z0-9-]+/SKILL.md", name):
            continue
        text = data.decode("utf-8")
        pieces = text.split("---", 2)
        if len(pieces) != 3 or pieces[0].strip():
            raise ValueError("Missing frontmatter: " + name)
        metadata = yaml.safe_load(pieces[1])
        slug = PurePosixPath(name).parent.name
        if not isinstance(metadata, dict) or metadata.get("name") != slug or not isinstance(metadata.get("description"), str):
            raise ValueError("Invalid skill metadata: " + name)
        tree = {n.removeprefix(prefix): hashlib.sha256(b).hexdigest() for n, b in sorted(files.items()) if n.startswith(str(PurePosixPath(name).parent) + "/")}
        skills.append({"name": slug, "metadata": metadata, "skill_sha256": hashlib.sha256(data).hexdigest(),
                       "tree_sha256": hashlib.sha256(json.dumps(tree, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                       "files": tree, "runtime_enabled": False})
    if len(skills) != 52:
        raise ValueError(f"Expected 52 skills, found {len(skills)}")
    risk_patterns = {"network": r"https?://", "credentials": r"(?i)api[_ -]?key|secret|token|authorization", "shell": r"(?i)\b(curl|wget|subprocess|child_process|execSync)\b", "affiliate": r"(?i)affiliate|partner|sponsored"}
    risks = {label: [n.removeprefix(prefix) for n, b in sorted(files.items()) if re.search(pattern, b.decode("utf-8", errors="ignore"))] for label, pattern in risk_patterns.items()}
    report = {"archive_sha256": digest, "skill_count": len(skills), "cli_count": sum(n.startswith(prefix + "tools/clis/") and n.endswith(".js") for n in files),
              "license": "MIT", "files": {n.removeprefix(prefix): hashlib.sha256(b).hexdigest() for n, b in sorted(files.items())},
              "skills": skills, "risk_file_matches": risks, "ignored_links": ignored_links, "helpers_executed": False}
    return report, files


def main():
    report, files = inspect_archive(ROOT / "inputs/marketingskills-main.zip")
    output = ROOT / "docs/evidence/skill-inventory.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    # Preserve attribution; the immutable ZIP remains the original source of all content.
    dest = ROOT / "vendor/marketing-skills"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "LICENSE").write_bytes(files["marketingskills-main/LICENSE"])
    print(f"Audited {report['skill_count']} skills and {report['cli_count']} inert CLI files; checksum verified.")


if __name__ == "__main__":
    main()
