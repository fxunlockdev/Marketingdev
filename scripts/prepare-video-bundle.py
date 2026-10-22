"""Offline ARM64 test bundle from exact APT-verified Debian archive pins.

No package scripts execute. Download acquisition is operator/build tooling, not
part of a customer request. Existing output is refused, never silently replaced.
"""
import hashlib
import io
import json
import posixpath
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent

def prepare(cache, output):
    pins = json.loads((ROOT/'apps/video/debian-arm64-packages.json').read_text())
    if output.exists():
        raise ValueError('Output must be a new directory')
    # Verify every archive before extracting any member.
    for pin in pins:
        name = pin['filename']
        if Path(name).name != name or not name.endswith('.deb'):
            raise ValueError('Invalid archive path')
        if hashlib.sha256((cache/name).read_bytes()).hexdigest() != pin['sha256']:
            raise ValueError('Debian archive digest mismatch: '+name)
    output.mkdir(parents=True)
    links = []
    for pin in pins:
        path = cache/pin['filename']
        names = subprocess.check_output(['ar', 't', str(path)], text=True).splitlines()
        member = next(n for n in names if n.startswith('data.tar.'))
        data = subprocess.check_output(['ar', 'p', str(path), member])
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for item in archive:
                name = item.name.removeprefix('./')
                if not (name in ['usr/bin/ffmpeg', 'usr/bin/ffprobe'] or name.startswith(('usr/lib/aarch64-linux-gnu/', 'usr/share/fonts/truetype/', 'usr/share/doc/'))):
                    continue
                if '..' in name.split('/') or name.startswith('/'):
                    raise ValueError('Archive path escape')
                target = output/name
                if item.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif item.isfile():
                    if item.size > 256*1024*1024:
                        raise ValueError('Archive member too large')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.extractfile(item).read())
                    target.chmod(0o755 if item.mode & 0o111 else 0o644)
                elif item.issym():
                    links.append((name, item.linkname))
                else:
                    raise ValueError('Unsupported archive member')
    # Create links only after all ordinary files; no extraction can follow a link.
    for name, link in links:
        resolved = posixpath.normpath(link.lstrip('/') if link.startswith('/') else posixpath.join(posixpath.dirname(name), link))
        if not resolved.startswith('usr/'):
            raise ValueError('Archive link escape')
        target = output/name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            target.unlink()
        target.symlink_to(posixpath.relpath(resolved, posixpath.dirname(name)))
    print('Verified and extracted', len(pins), 'pinned Debian archives without package scripts; ARM64 test bundle only')

if __name__ == '__main__':
    prepare(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
