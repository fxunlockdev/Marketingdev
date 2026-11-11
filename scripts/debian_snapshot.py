"""Recover retired Debian archives; reviewed SHA256 pins remain the trust anchor.

Snapshot API: https://salsa.debian.org/snapshot-team/snapshot/raw/master/API
Never install packages or accept a different version/digest.
"""
import hashlib
import json
from pathlib import Path
import re
import tempfile
import time
from urllib.parse import quote
from urllib.request import urlopen

ORIGIN = 'https://snapshot.debian.org'
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024


def recover_archive(pin, directory, opener=urlopen, deadline=None):
    def timeout(limit):
        remaining = limit if deadline is None else min(limit, deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError("Pinned archive recovery deadline exceeded")
        return remaining
    directory = Path(directory)
    filename = pin['filename']
    if Path(filename).name != filename or not filename.endswith('.deb'):
        raise ValueError('Invalid archive filename')
    if not re.fullmatch(r'[a-f0-9]{64}', pin['sha256']):
        raise ValueError('Invalid archive digest')
    target = directory / filename
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != pin['sha256']:
            raise ValueError('Existing archive digest mismatch: ' + pin['Package'])
        return
    package, version = quote(pin['Package'], safe=''), quote(pin['Version'], safe='')
    with opener(f'{ORIGIN}/mr/binary/{package}/{version}/binfiles', timeout=timeout(20)) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('Oversized snapshot metadata')
    metadata = json.loads(raw)
    candidates = [row['hash'] for row in metadata['result']
                  if row.get('architecture') == pin['Architecture']
                  and re.fullmatch(r'[a-f0-9]{40}', row.get('hash', ''))]
    if not candidates:
        raise ValueError('Pinned archive unavailable: ' + pin['Package'])
    for digest in candidates:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix='.snapshot-', delete=False) as output:
                temporary = Path(output.name)
                checksum, size = hashlib.sha256(), 0
                with opener(f'{ORIGIN}/file/{digest}', timeout=timeout(30)) as response:
                    while chunk := response.read(1024 * 1024):
                        timeout(30)
                        size += len(chunk)
                        if size > MAX_ARCHIVE_BYTES:
                            raise ValueError('Oversized snapshot archive')
                        checksum.update(chunk)
                        output.write(chunk)
            if checksum.hexdigest() == pin['sha256']:
                temporary.replace(target)
                return
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    raise ValueError('Snapshot archive digest mismatch: ' + pin['Package'])
