import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prepareDocumentImage } from './document-test-image.mjs';

// Use the existing pinned document test image and synthetic fixtures only.
// This does not enable the unfinished customer document-visual protocol.
const image = prepareDocumentImage();
for (const name of ['guidelines.pdf', 'no-text.pdf', 'fifty-pages.pdf']) {
  if (!existsSync(`work/document-fixtures/${name}`)) {
    throw new Error('Prepare the existing document test fixtures before this focused suite');
  }
}
if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Exact image digest required');
const mounts = [
  ['apps/ingestion/document_visuals.py', '/proof/apps/ingestion/document_visuals.py'],
  ['tests/test_document_visuals.py', '/proof/tests/test_document_visuals.py'],
  ['work/document-fixtures', '/proof/work/document-fixtures'],
  ['work/document-fixtures', '/fixtures'],
  ['tests/test_document_native.py', '/proof/test_document_native.py'],
].flatMap(([source, destination]) => ['--mount', `type=bind,src=${resolve(source)},dst=${destination},readonly`]);
console.log(`Document rendering component only; isolated image ${image}; no provider calls`);
for (const testFile of ['/proof/tests/test_document_visuals.py', '/proof/test_document_native.py']) {
const name = `desvio-document-proof-${randomUUID()}`;
const result = spawnSync('docker', ['run', '--rm', '--name', name, '--network', 'none', '--read-only', '--user', '65534:65534',
  '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '1g',
  '--memory-swap', '1g', '--cpus', '1', '--tmpfs', '/tmp:rw,noexec,nosuid,size=96m', ...mounts,
  '--entrypoint', 'python', image, testFile, '-v'],
{ stdio: 'inherit', timeout: 120000 });
spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 10000 });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
}
