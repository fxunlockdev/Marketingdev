"""Package reviewed private Markdown. Does not update trusted pins automatically."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'skills/desvio-production'
output = root / 'inputs/desvio-production.zip'
files = sorted(source.rglob('*.md'))
if not files or not (source / 'SKILL.md').is_file():
    raise SystemExit('Restore the reviewed private skill source before packaging.')
if any(p.is_symlink() for p in source.rglob('*')):
    raise SystemExit('Symlinks are not allowed in a production skill.')
if len(files) > 30 or sum(p.stat().st_size for p in files) > 150000:
    raise SystemExit('Production rules exceed runtime bounds.')
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for p in files:
        name = 'desvio-production/' + p.relative_to(source).as_posix()
        info = zipfile.ZipInfo(name, (2026, 11, 9, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o600 << 16
        archive.writestr(info, p.read_bytes())
print(json.dumps({'archive_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                  'notice': 'Review this digest before changing the trusted audit pin.'}))
