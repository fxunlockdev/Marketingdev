"""Inspect the actual Docker upload boundary, without secrets or running containers."""
import io
import subprocess
import tarfile
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
tag = f'desvio-context-test:{uuid.uuid4().hex}'
container = None

def docker(*args):
    return subprocess.run(['docker', *args], cwd=ROOT, check=True, capture_output=True).stdout

try:
    with tempfile.TemporaryDirectory(prefix='context-test-', dir=ROOT / 'work') as folder:
        recipe = Path(folder) / 'Dockerfile'
        recipe.write_text('FROM scratch\nCOPY . /context/\n')
        docker('build', '-f', str(recipe), '-t', tag, '.')
        container = docker('create', tag, '/unused').decode().strip()
        archive = docker('export', container)
        assert len(archive) < 5_000_000, 'Build context unexpectedly exceeds 5 MB'
        with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
            files = [m.name.removeprefix('context/') for m in contents if m.isfile() and m.name.startswith('context/')]
        exact = {'package.json','package-lock.json','tsconfig.json','apps/web/next.config.mjs','apps/web/next-env.d.ts','apps/web/proxy.ts','apps/web/tsconfig.json',
                 'scripts/start-worker-host.mjs','scripts/bootstrap-database.mjs','scripts/migrate.mjs','scripts/build-web.mjs','scripts/start-web.mjs'}
        prefixes = ('apps/api/src/','apps/web/app/','apps/web/components/','apps/web/public/','apps/web/lib/','database/migrations/')
        for name in files:
            assert name in exact or name.startswith(prefixes) or (name.startswith('infra/') and name.endswith('.Dockerfile')), f'Unexpected build input: {name}'
            assert not any(part.startswith('.env') or part in {'.git','.venv','node_modules','__pycache__','.next'} for part in Path(name).parts), f'Private or generated build input: {name}'
        assert exact <= set(files), 'Required deployment sources missing'
        assert 'apps/web/lib/published-media.mjs' in files
        assert 'apps/api/src/local-calendar.ts' in files
        assert 'apps/web/components/content-workspace.tsx' in files
        print(f'Actual Docker context verified: {len(files)} files, {len(archive)} archive bytes; source allowlist only')
finally:
    if container:
        docker('rm', container)
    subprocess.run(['docker','image','rm',tag], cwd=ROOT, capture_output=True)
