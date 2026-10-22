// MOCK provider HTTP only. No funded account, provider video or live verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHiggsfieldClient } from '@higgsfield/client/v2';
import { HiggsfieldClient, HiggsfieldError, HIGGSFIELD_MODELS } from '../../dist/higgsfield-client.js';

const id = '3c90c3cc-0d44-4b50-8888-8dd25736052a';
const key = 'd7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
const config = { mode: 'test', credentials: 'MOCK-id:MOCK-secret', models: Object.values(HIGGSFIELD_MODELS), referenceOrigins: ['https://media.example.com'] };
const image = () => ({ kind: 'image', model: HIGGSFIELD_MODELS.image, idempotencyKey: key,
  referenceURL: 'https://media.example.com/owned.png?signature=MOCK', prompt: 'MOCK brand video', durationSeconds: 5, sound: 'off' });
const edit = () => ({ kind: 'edit', model: HIGGSFIELD_MODELS.edit, idempotencyKey: key,
  referenceURL: 'https://media.example.com/owned.mp4?signature=MOCK', prompt: 'MOCK revise the lighting', quality: 'std' });
const json = (res, value, status = 200, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(value));
};
async function server(t, handler) {
  const calls = [], failures = [];
  const srv = http.createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part;
      const call = { method: req.method, path: req.url, headers: req.headers, body };
      calls.push(call); await handler(call, res, calls.length);
    } catch (e) { failures.push(e); res.destroy(); }
  });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(async () => { srv.closeAllConnections(); await new Promise(resolve => srv.close(resolve)); assert.deepEqual(failures, []); });
  return { calls, origin: `http://127.0.0.1:${srv.address().port}` };
}
const error = (code, outcome = 'not_sent') => e => e instanceof HiggsfieldError && e.code === code && e.outcome === outcome &&
  !`${e.stack} ${JSON.stringify(e)}`.includes('MOCK-secret');
const submit = (client, intent = image()) => client.submit(intent, client.prepare(intent).sha256);

test('Higgsfield image and edit serialize the same bounded bodies as pinned SDK; no implicit polling', async t => {
  const s = await server(t, (_c, r) => json(r, { request_id: id, status: 'queued' }));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  for (const intent of [image(), edit()]) {
    const prepared = client.prepare(intent);
    const sdk = createHiggsfieldClient({ credentials: config.credentials, baseURL: s.origin, maxRetries: 0, headers: { 'Idempotency-Key': key } });
    await sdk.subscribe(intent.model, { input: JSON.parse(prepared.body), withPolling: false });
    assert.deepEqual(await client.submit(intent, prepared.sha256), {
      requestId: id, statusURL: `${s.origin}/requests/${id}/status`, cancelURL: `${s.origin}/requests/${id}/cancel`,
    });
    const [a, b] = s.calls.slice(-2);
    assert.equal(a.path, `/${intent.model}`); assert.equal(b.path, a.path);
    assert.equal(a.method, 'POST'); assert.equal(b.method, 'POST');
    assert.deepEqual(JSON.parse(a.body), JSON.parse(b.body));
    assert.equal(b.headers.authorization, 'Key MOCK-id:MOCK-secret');
    assert.equal(b.headers['idempotency-key'], key);
    assert.equal(b.headers['content-type'], 'application/json');
  }
  assert.equal(s.calls.length, 4);
  assert.deepEqual(JSON.parse(s.calls[1].body), { prompt: 'MOCK brand video', image_url: image().referenceURL,
    duration: 5, sound: 'off', cfg_scale: 0.5, multi_shots: false });
  assert.deepEqual(JSON.parse(s.calls[3].body), { prompt: edit().prompt, video_urls: [edit().referenceURL], mode: 'std' });
  assert.ok(!JSON.stringify(client).includes('MOCK-secret'));
});

test('Higgsfield default origin is fixed; exact headers, redirect denial and abort signal reach transport', async () => {
  let calls = 0;
  const client = new HiggsfieldClient({ ...config, mode: 'staging' }, async (url, init) => {
    calls++; assert.equal(String(url), `https://api.higgsfield.ai/${HIGGSFIELD_MODELS.image}`);
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ request_id: id });
  });
  await submit(client); assert.equal(calls, 1);
});

test('Higgsfield configuration denies production, unsafe overrides, credentials and unreviewed model IDs', () => {
  const invalid = [
    { mode: 'production' }, { mode: 'staging', testBaseURL: 'http://127.0.0.1:3000' },
    { testBaseURL: 'https://api.higgsfield.ai' }, { testBaseURL: 'http://localhost:3000' },
    { testBaseURL: 'http://127.0.0.1:3000/path' }, { testBaseURL: 'http://user:pass@127.0.0.1:3000' },
    { credentials: '' }, { credentials: 'x:y:z' }, { credentials: 'x:y\r\nINJECT' },
    { credentials: ':secret' }, { credentials: 'a'.repeat(2050) + ':b' },
    { models: [] }, { models: ['unreviewed/preview'] }, { timeoutMs: 0 }, { timeoutMs: 60001 },
    { referenceOrigins: [] }, { referenceOrigins: ['http://media.example.com'] },
    { referenceOrigins: ['https://media.example.com/path'] }, { referenceOrigins: ['https://user:secret@media.example.com'] },
    { referenceOrigins: ['https://127.0.0.1'] }, { referenceOrigins: ['https://metadata.internal'] },
  ];
  for (const change of invalid) assert.throws(() => new HiggsfieldClient({ ...config, ...change }), error('HIGGSFIELD_CONFIG_INVALID'));
});

test('Higgsfield rejects extra parameters, model mismatches, unsafe/unowned references and invalid bounded inputs before any call', async () => {
  let calls = 0;
  const client = new HiggsfieldClient(config, async () => { calls++; throw new Error('must not send'); });
  const invalid = [
    { model: HIGGSFIELD_MODELS.edit }, { model: '../../steal' }, { kind: 'other' },
    { idempotencyKey: key + '/status' }, { idempotencyKey: ' ' }, { prompt: ' ' }, { prompt: 'a'.repeat(10001) },
    { prompt: 'bad\0' }, { durationSeconds: 2 }, { durationSeconds: 16 }, { durationSeconds: 4.5 }, { sound: 'auto' },
    { referenceURL: 'https://other.example.com/other-business.png' },
    { referenceURL: 'http://media.example.com/owned.png' }, { referenceURL: 'https://media.example.com.evil.com/owned.png' },
    { referenceURL: 'https://user:pass@media.example.com/owned.png' }, { referenceURL: 'https://media.example.com/owned.png#data' },
    { referenceURL: 'https://media.example.com/owned.png\n' }, { referenceURL: 'https://media.example.com\\owned.png' },
    { webhook: 'https://attacker.example.com' }, { elements: ['arbitrary'] },
  ];
  for (const change of invalid) await assert.rejects(client.submit({ ...image(), ...change }, 'x'), error('HIGGSFIELD_INPUT_INVALID'));
  assert.throws(() => new HiggsfieldClient({ ...config, models: [HIGGSFIELD_MODELS.image] }).prepare(edit()), error('HIGGSFIELD_INPUT_INVALID'));
  assert.throws(() => client.prepare({ ...edit(), quality: 'auto' }), error('HIGGSFIELD_INPUT_INVALID'));
  assert.throws(() => client.prepare({ ...edit(), durationSeconds: 5 }), error('HIGGSFIELD_INPUT_INVALID'));
  assert.equal(calls, 0);
});

test('Higgsfield replay fingerprint includes exact signed URL, prompt, duration, sound, quality and model', async () => {
  let calls = 0; const client = new HiggsfieldClient(config, async () => { calls++; throw new Error(); });
  const initial = client.prepare(image());
  assert.ok(Object.isFrozen(initial)); assert.match(initial.sha256, /^[a-f0-9]{64}$/);
  for (const change of [{ referenceURL: image().referenceURL + 'new' }, { prompt: image().prompt + ' ' }, { durationSeconds: 6 }, { sound: 'on' }]) {
    await assert.rejects(client.submit({ ...image(), ...change }, initial.sha256), error('HIGGSFIELD_REPLAY_MISMATCH'));
  }
  await assert.rejects(client.submit({ ...edit(), quality: 'pro' }, client.prepare(edit()).sha256), error('HIGGSFIELD_REPLAY_MISMATCH'));
  assert.notEqual(client.prepare(edit()).sha256, initial.sha256); assert.equal(calls, 0);
});

test('Higgsfield receipt retains recoverable ID despite unknown state and ignores returned API URLs', async t => {
  const s = await server(t, (c, r) => c.method === 'POST'
    ? json(r, { request_id: id, status: 'future-state', status_url: 'https://attacker.example.com/steal', cancel_url: 'file:///etc/passwd' })
    : json(r, { request_id: id, status: 'completed', video: { url: 'https://cdn.example.com/video.mp4?MOCK=secret' } }));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  const receipt = await submit(client);
  assert.equal(receipt.statusURL, `${s.origin}/requests/${id}/status`);
  const observed = await client.status(receipt.requestId); assert.equal(observed.state, 'completed');
  assert.equal(s.calls[1].path, `/requests/${id}/status`);
  assert.equal(s.calls[1].headers['idempotency-key'], undefined);
});

test('Higgsfield authenticated polling validates every terminal/nonterminal state without leaking provider error text', async t => {
  const states = ['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'];
  const s = await server(t, (_c, r, n) => json(r, { request_id: id, status: states[n - 1], error: 'MOCK-secret echoed prompt',
    video: { url: 'https://cdn.example.com/out.mp4' } }));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  for (const state of states) {
    const v = await client.status(id); assert.equal(v.state, state);
    assert.equal(v.videoURL, state === 'completed' ? 'https://cdn.example.com/out.mp4' : null);
    assert.ok(!JSON.stringify(v).includes('MOCK-secret'));
    assert.equal(v.errorCode, state === 'failed' ? 'HIGGSFIELD_GENERATION_FAILED' : state === 'nsfw' ? 'HIGGSFIELD_MODERATION_REJECTED' : null);
  }
  assert.ok(s.calls.every(c => c.method === 'GET' && c.headers.authorization === 'Key MOCK-id:MOCK-secret'));
});

test('Higgsfield malformed or foreign status and unsafe completed media never become successful observations', async t => {
  const values = [null, [], {}, { request_id: key, status: 'queued' }, { request_id: id, status: 'success' },
    ...[undefined, {}, { url: 'http://cdn.example.com/x' }, { url: 'https://127.0.0.1/x' },
      { url: 'https://host.internal/x' }, { url: 'https://user:secret@cdn.example.com/x' }, { url: 'https://cdn.example.com/x#fragment' }]
      .map(video => ({ request_id: id, status: 'completed', video }))];
  const s = await server(t, (_c, r, n) => json(r, values[n - 1]));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  for (const _ of values) await assert.rejects(client.status(id), error('HIGGSFIELD_RESPONSE_INVALID'));
  const count = s.calls.length;
  for (const bad of ['../x', `${id}?url=evil`, `/${id}`, '', id.toUpperCase()]) {
    await assert.rejects(client.status(bad), error('HIGGSFIELD_REQUEST_ID_INVALID'));
    await assert.rejects(client.cancel(bad), error('HIGGSFIELD_REQUEST_ID_INVALID'));
  }
  assert.equal(s.calls.length, count);
});

test('Higgsfield cancellation accepts only empty 202 and needs independent status reconciliation', async t => {
  const s = await server(t, (c, r) => c.method === 'POST' ? (r.writeHead(202), r.end()) : json(r, { request_id: id, status: 'canceled' }));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  assert.deepEqual(await client.cancel(id), { requestId: id, state: 'cancel_requested' });
  assert.equal((await client.status(id)).state, 'canceled');
  assert.equal(s.calls[0].path, `/requests/${id}/cancel`); assert.equal(s.calls[0].body, '');
});

test('Higgsfield cancellation refuses unexpected success envelopes and keeps ambiguous outcomes', async t => {
  const s = await server(t, (_c, r, n) => n === 1 ? json(r, { accepted: true }, 202) : (r.writeHead(204), r.end()));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  for (let i = 0; i < 2; i++) await assert.rejects(client.cancel(id), error('HIGGSFIELD_RESPONSE_INVALID', 'unknown'));
  assert.equal(s.calls.length, 2);
});

for (const [status, code, outcome] of [
  [400, 'HIGGSFIELD_REQUEST_REJECTED', 'rejected'], [401, 'HIGGSFIELD_AUTH_REJECTED', 'rejected'],
  [403, 'HIGGSFIELD_ACCESS_OR_CREDITS_REJECTED', 'rejected'], [404, 'HIGGSFIELD_REQUEST_REJECTED', 'rejected'],
  [422, 'HIGGSFIELD_PARAMETERS_REJECTED', 'rejected'], [429, 'HIGGSFIELD_RATE_LIMITED', 'rejected'],
  [500, 'HIGGSFIELD_UNAVAILABLE', 'unknown'], [502, 'HIGGSFIELD_UNAVAILABLE', 'unknown'],
]) test(`Higgsfield ${status} is sanitized and never automatically resubmitted`, async t => {
  const s = await server(t, (_c, r) => json(r, { detail: 'MOCK-secret and private prompt' }, status, { 'Retry-After': '999999' }));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  await assert.rejects(submit(client), e => error(code, outcome)(e) && e.retryAfterSeconds === 3600);
  assert.equal(s.calls.length, 1);
});

test('Higgsfield missing status is not success and cancellation racing processing does not claim canceled', async t => {
  const s = await server(t, (c, r) => json(r, { detail: 'MOCK-secret' }, c.method === 'GET' ? 404 : 400));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  await assert.rejects(client.status(id), error('HIGGSFIELD_REQUEST_NOT_FOUND', 'rejected'));
  await assert.rejects(client.cancel(id), error('HIGGSFIELD_CANCEL_REJECTED', 'rejected'));
});

test('Higgsfield request timeout and abrupt socket loss retain an unknown submission without retry', async t => {
  for (const handler of [(_c, _r) => {}, (_c, r) => r.destroy()]) {
    const s = await server(t, handler), client = new HiggsfieldClient({ ...config, testBaseURL: s.origin, timeoutMs: 50 });
    await assert.rejects(submit(client), e => e instanceof HiggsfieldError && e.outcome === 'unknown' && ['HIGGSFIELD_TIMEOUT', 'HIGGSFIELD_NETWORK_ERROR'].includes(e.code));
    assert.equal(s.calls.length, 1);
  }
});

test('Higgsfield redirect cannot send credentials or private reference to another endpoint', async t => {
  const target = await server(t, (_c, r) => json(r, { request_id: id }));
  const source = await server(t, (_c, r) => { r.writeHead(307, { Location: target.origin + '/steal' }); r.end(); });
  const client = new HiggsfieldClient({ ...config, testBaseURL: source.origin });
  await assert.rejects(submit(client), error('HIGGSFIELD_NETWORK_ERROR', 'unknown'));
  assert.equal(source.calls.length, 1); assert.equal(target.calls.length, 0);
});

test('Pinned Higgsfield SDK follows a 307 with its submitted reference; this explains the bounded HTTP adapter', async t => {
  const s = await server(t, (c, r) => {
    if (c.path === '/redirected') return json(r, { request_id: id, status: 'queued' });
    r.writeHead(307, { Location: '/redirected' }); r.end();
  });
  const sdk = createHiggsfieldClient({ credentials: config.credentials, baseURL: s.origin, maxRetries: 0 });
  await sdk.subscribe(HIGGSFIELD_MODELS.image, { input: { image_url: image().referenceURL }, withPolling: false });
  assert.equal(s.calls.length, 2); assert.equal(s.calls[1].path, '/redirected');
  assert.equal(s.calls[1].body, s.calls[0].body); assert.equal(s.calls[1].headers.authorization, 'Key MOCK-id:MOCK-secret');
});

test('Higgsfield successful HTTP with malformed, oversized, truncated or slow body is ambiguous and bounded', async t => {
  const handlers = [
    (_c, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('MOCK-secret'); },
    (_c, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end('{bad'); },
    (_c, r) => { r.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '70000' }); r.end('x'); },
    (_c, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.write('x'.repeat(65536)); r.end('x'); },
    (_c, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(Buffer.from([0xff])); },
    (_c, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.flushHeaders(); r.write('{'); },
  ];
  for (const handler of handlers) {
    const s = await server(t, handler), client = new HiggsfieldClient({ ...config, testBaseURL: s.origin, timeoutMs: 100 });
    await assert.rejects(submit(client), e => e instanceof HiggsfieldError && e.outcome === 'unknown' && ['HIGGSFIELD_TIMEOUT', 'HIGGSFIELD_RESPONSE_INVALID'].includes(e.code));
    assert.equal(s.calls.length, 1);
  }
});

test('Higgsfield invalid acceptance ID is held unknown rather than resubmitted', async t => {
  const values = [null, {}, { request_id: '../steal' }, { request_id: 123 }, { status: 'completed', video: { url: 'https://cdn.example.com/x' } }];
  const s = await server(t, (_c, r, n) => json(r, values[n - 1]));
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  for (const _ of values) await assert.rejects(submit(client), error('HIGGSFIELD_RECEIPT_INVALID', 'unknown'));
  assert.equal(s.calls.length, values.length);
});

test('Higgsfield explicit identical-key replay preserves request identity; changed URLs require a new intentional generation', async t => {
  const accepted = new Map(); let generations = 0;
  const s = await server(t, (c, r) => {
    const k = c.headers['idempotency-key'], original = accepted.get(k);
    if (original && original !== c.body) return json(r, { detail: 'parameters changed' }, 422);
    if (!original) { accepted.set(k, c.body); generations++; }
    json(r, { request_id: id, status: 'queued' });
  });
  const client = new HiggsfieldClient({ ...config, testBaseURL: s.origin });
  assert.equal((await submit(client)).requestId, (await submit(client)).requestId);
  const changed = { ...image(), referenceURL: image().referenceURL + 'refreshed' };
  await assert.rejects(submit(client, changed), error('HIGGSFIELD_PARAMETERS_REJECTED', 'rejected'));
  assert.equal(generations, 1); assert.equal(s.calls.length, 3);
});
