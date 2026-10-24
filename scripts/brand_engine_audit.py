"""Immutable owner-supplied Brand Engine archive; never execute bundled content."""
from pathlib import PurePosixPath
import hashlib,json,stat,zipfile
from scripts.skill_audit import ROOT
ARCHIVE_SHA = "9348eaa7f655a69434158087133d38e02c843f48fa54b039dc96da0b74f90125"
def inspect_brand_engine():
    path=ROOT / "inputs/brand-engine-gpt-2k.zip"
    if hashlib.sha256(path.read_bytes()).hexdigest()!=ARCHIVE_SHA:
        raise ValueError("SKILL_DIGEST_MISMATCH")
    files={}
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist())>30 or sum(i.file_size for i in archive.infolist())>200000:
            raise ValueError("SKILL_ARCHIVE_LIMIT")
        for info in archive.infolist():
            p=PurePosixPath(info.filename)
            if p.is_absolute() or ".." in p.parts or "\\" in info.filename or not p.parts or p.parts[0]!="brand-engine" or stat.S_ISLNK(info.external_attr>>16):
                raise ValueError("SKILL_PATH_DENIED")
            if not info.is_dir():
                if info.filename in files: raise ValueError("SKILL_PATH_DENIED")
                files[info.filename]=archive.read(info)
    tree={n:hashlib.sha256(b).hexdigest() for n,b in sorted(files.items())}
    pin={"name":"brand-engine","skill_sha256":tree["brand-engine/SKILL.md"],"tree_sha256":hashlib.sha256(json.dumps(tree,sort_keys=True,separators=(",", ":")).encode()).hexdigest()}
    return pin,{"/skills/"+n:b for n,b in files.items() if n.endswith(".md")}
