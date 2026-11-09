"""Owner production guidance, audited inert Markdown and task-scoped mounts."""
import hashlib
import json
import stat
import zipfile
from pathlib import PurePosixPath
from scripts.skill_audit import ROOT

ARCHIVE_SHA = 'ad1d3336d4e6c8c64ab4fa7d0a44c5c2d278a135ee4c3d3ffb7611802c853e8c'
COMMON = ('context-and-scope', 'strategy-and-claims', 'feedback-versions-and-handoffs')
VISUAL = ('art-direction-and-grid', 'identity-and-physical-realism', 'composition-and-legibility')
TASK_REFERENCES = {
    'creative': COMMON + VISUAL + ('copywriting-and-editorial-quality', 'image-generation-and-visual-production', 'creative-style-directions', 'resolution-and-release', 'final-quality-checklist'),
    'carousel': COMMON + VISUAL + ('copywriting-and-editorial-quality', 'image-generation-and-visual-production', 'creative-style-directions', 'final-quality-checklist'),
    'video': COMMON + ('identity-and-physical-realism', 'composition-and-legibility', 'copywriting-and-editorial-quality', 'production-and-approval', 'final-quality-checklist'),
    'plan': COMMON + ('brand-strategy-and-customer-research', 'art-direction-and-grid', 'creative-style-directions', 'calendar-recurring-production-and-publishing', 'production-and-approval'),
    'insights': ('context-and-scope', 'strategy-and-claims', 'brand-strategy-and-customer-research', 'feedback-versions-and-handoffs'),
}


def inspect_production_rules(task, path=None):
    if task not in TASK_REFERENCES:
        raise ValueError('SKILL_TASK_DENIED')
    path = path or ROOT / 'inputs/desvio-production.zip'
    if hashlib.sha256(path.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('SKILL_DIGEST_MISMATCH')
    files = {}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 30 or sum(i.file_size for i in entries) > 150000:
            raise ValueError('SKILL_ARCHIVE_LIMIT')
        for info in entries:
            p = PurePosixPath(info.filename)
            if (p.is_absolute() or '..' in p.parts or '\\' in info.filename or
                not p.parts or p.parts[0] != 'desvio-production' or
                stat.S_ISLNK(info.external_attr >> 16) or
                info.is_dir() or not info.filename.endswith('.md') or info.filename in files):
                raise ValueError('SKILL_PATH_DENIED')
            files[info.filename] = archive.read(info)
    tree = {n: hashlib.sha256(b).hexdigest() for n,b in sorted(files.items())}
    pin = {'name':'desvio-production', 'skill_sha256':tree['desvio-production/SKILL.md'],
           'tree_sha256':hashlib.sha256(json.dumps(tree,sort_keys=True,separators=(',', ':')).encode()).hexdigest()}
    selected = ['desvio-production/SKILL.md'] + [f'desvio-production/references/{n}.md' for n in TASK_REFERENCES[task]]
    return pin, {'/skills/'+n:files[n] for n in selected}
