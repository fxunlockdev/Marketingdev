// MOCK media bytes are intentionally NOT a decodable/generated video.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SafeWeb } from '../../dist/safe-web.js';
import { VideoDownload, VideoDownloadError, MAX_VIDEO_DOWNLOAD_BYTES } from '../../dist/video-download.js';
const origin = 'https://cdn.example.com';
const bytes = Buffer.from('MOCK untrusted bytes - not real video');
const response = () => ({ status: 200, headers: { 'content-type': 'video/mp4' }, bytes });
const code = expected => e => e instanceof VideoDownloadError && e.code === expected && !e.message.includes('signed-secret');

test('Video download is bounded and credential-free; downloaded bytes remain explicitly untrusted', async () => {
  let calls = 0;
  const download = new VideoDownload([origin], { fetch: async (...args) => {
    calls++; assert.equal(args.length, 3); assert.equal(args[0].href, origin + '/out.mp4?token=signed-secret');
    assert.equal(args[1], MAX_VIDEO_DOWNLOAD_BYTES); assert.equal(args[2], 'video/mp4');
    return { ...response(), headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } };
  } });
  const result = await download.read(origin + '/out.mp4?token=signed-secret');
  assert.equal(result.state, 'untrusted_video'); assert.deepEqual(result.bytes, bytes);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.url, undefined); assert.equal(result.approved, undefined); assert.equal(calls, 1);
});

test('Video download denies unsafe configuration and unallowlisted references before fetching', async () => {
  for (const values of [[], ['http://cdn.example.com'], ['https://cdn.example.com/path'], ['https://127.0.0.1'], ['https://host.internal'], ['https://u:p@cdn.example.com']]) {
    assert.throws(() => new VideoDownload(values), code('VIDEO_DOWNLOAD_CONFIG_INVALID'));
  }
  let calls = 0; const download = new VideoDownload([origin], { fetch: async () => { calls++; return response(); } });
  for (const url of ['https://evil.example.com/x', 'http://cdn.example.com/x', origin + '/x#fragment', origin + '/x\n',
    'https://u:p@cdn.example.com/x', 'file:///etc/passwd', 'https://169.254.169.254/x', 'https://cdn.example.com.evil.com/x']) {
    await assert.rejects(download.read(url), code('VIDEO_DOWNLOAD_URL_BLOCKED'));
  }
  assert.equal(calls, 0);
});

test('Video download rejects private, mixed and rebound DNS before network connection using actual SafeWeb guard', async () => {
  for (const addresses of [
    [{ address: '127.0.0.1', family: 4 }], [{ address: '169.254.169.254', family: 4 }],
    [{ address: '::1', family: 6 }], [{ address: '::ffff:127.0.0.1', family: 6 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '10.1.1.1', family: 4 }],
  ]) {
    let resolves = 0;
    const download = new VideoDownload([origin], new SafeWeb(async () => { resolves++; return addresses; }));
    await assert.rejects(download.read(origin + '/out.mp4'), code('VIDEO_DOWNLOAD_FAILED')); assert.equal(resolves, 1);
  }
});

test('Video download refuses redirects, expired URLs, MIME/encoding/length mismatches and oversized bodies', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const downloader = new VideoDownload([origin], { fetch: async () => ({ ...response(), status, headers: { location: 'https://metadata.internal' } }) });
    await assert.rejects(downloader.read(origin + '/out'), code('VIDEO_DOWNLOAD_REDIRECT_BLOCKED'));
  }
  for (const status of [206, 401, 403, 404, 500]) {
    await assert.rejects(new VideoDownload([origin], { fetch: async () => ({ ...response(), status }) }).read(origin + '/out'), code('VIDEO_DOWNLOAD_HTTP_ERROR'));
  }
  for (const change of [
    { headers: { 'content-type': 'text/html' } }, { headers: { 'content-type': ['video/mp4'] } },
    { headers: { 'content-type': 'video/mp4', 'content-encoding': 'gzip' } },
    { headers: { 'content-type': 'video/mp4', 'content-length': 'abc' } },
    { headers: { 'content-type': 'video/mp4', 'content-length': '1' } },
    { bytes: Buffer.alloc(23) }, { bytes: Buffer.alloc(MAX_VIDEO_DOWNLOAD_BYTES + 1) },
  ]) await assert.rejects(new VideoDownload([origin], { fetch: async () => ({ ...response(), ...change }) }).read(origin + '/out'), code('VIDEO_DOWNLOAD_INVALID'));
});

test('Video download redacts network errors and signed URLs', async () => {
  await assert.rejects(new VideoDownload([origin], { fetch: async () => { throw new Error('https://cdn.example.com?signed-secret'); } }).read(origin + '/out'), code('VIDEO_DOWNLOAD_FAILED'));
});
