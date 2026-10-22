import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

export function prepareDocumentNativeImage() {
  const base = execFileSync('docker', ['image', 'inspect', 'desvio-ingestion:local', '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(base)) throw new Error('Build the existing pinned ingestion image first');
  const pins = JSON.parse(readFileSync('apps/ingestion/debian-document-arm64-packages.json', 'utf8'));
  if (pins.some(pin => !existsSync(resolve('work/document-deps-arm64/debs', pin.filename)))) {
    execFileSync('python3', ['scripts/fetch-document-deps.py'], { stdio: 'inherit', timeout: 320000 });
  }
  // Check all archives before invoking the build. No runtime download fallback.
  for (const pin of pins) {
    if (basename(pin.filename) !== pin.filename || !pin.filename.endsWith('.deb') || !['arm64', 'all'].includes(pin.Architecture)) throw new Error('Invalid document dependency pin');
    const actual = createHash('sha256').update(readFileSync(resolve('work/document-deps-arm64/debs', pin.filename))).digest('hex');
    if (actual !== pin.sha256) throw new Error(`Document dependency checksum mismatch: ${pin.Package}`);
  }
  const context = mkdtempSync(resolve('work/document-native-build-'));
  try {
    mkdirSync(`${context}/debs`);
    for (const pin of pins) copyFileSync(resolve('work/document-deps-arm64/debs', pin.filename), `${context}/debs/${pin.filename}`);
    for (const file of ['document_visuals.py', 'document_native.py']) copyFileSync(`apps/ingestion/${file}`, `${context}/${file}`);
    copyFileSync('apps/ingestion/Dockerfile.documents', `${context}/Dockerfile`);
    execFileSync('docker', ['build', '--network', 'none', '--build-arg', `BASE_IMAGE=${base}`, '-t', 'desvio-document-native:local', context], { stdio: 'inherit', timeout: 300000 });
    const image = execFileSync('docker', ['image', 'inspect', 'desvio-document-native:local', '--format', '{{.Id}}'], { encoding: 'utf8', timeout: 10000 }).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Exact document image digest missing');
    return image;
  } finally { rmSync(context, { recursive: true, force: true }); }
}
if (process.argv[1] === resolve('scripts/document-native-image.mjs')) console.log(prepareDocumentNativeImage());
