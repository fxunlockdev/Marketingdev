import { createHash } from 'node:crypto';
import { websiteURL } from './safe-web.js';

export const HIGGSFIELD_MODELS = {
  image: 'kling-video/v3.0/std/image-to-video',
  edit: 'kling-video/o3/video-edit',
} as const;
export type VideoModel = typeof HIGGSFIELD_MODELS[keyof typeof HIGGSFIELD_MODELS];
export type VideoState = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
export type VideoOutcome = 'not_sent' | 'rejected' | 'unknown';
export class HiggsfieldError extends Error {
  constructor(readonly code: string, readonly outcome: VideoOutcome = 'not_sent', readonly retryAfterSeconds?: number) {
    super(code); this.name = 'HiggsfieldError';
  }
}
export type HiggsfieldConfig = {
  mode: 'test' | 'development' | 'staging';
  credentials: string;
  models: VideoModel[];
  referenceOrigins: string[];
  timeoutMs?: number;
  // Only a loopback MOCK server is permitted; never a deployment/provider override.
  testBaseURL?: string;
};
export type VideoIntent = {
  kind: 'image'; model: typeof HIGGSFIELD_MODELS.image; idempotencyKey: string;
  referenceURL: string; prompt: string; durationSeconds: number; sound: 'on' | 'off';
} | {
  kind: 'edit'; model: typeof HIGGSFIELD_MODELS.edit; idempotencyKey: string;
  referenceURL: string; prompt: string; quality: 'std' | 'pro' | '4k';
};
export type VideoReceipt = { requestId: string; statusURL: string; cancelURL: string };
export type VideoObservation = {
  requestId: string; state: VideoState;
  // Untrusted remote media locator; not a validated or privately saved asset.
  videoURL: string | null;
  errorCode: 'HIGGSFIELD_GENERATION_FAILED' | 'HIGGSFIELD_MODERATION_REJECTED' | null;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const jsonLimit = 64 * 1024;
const fail = (): never => { throw new Error('invalid'); };
const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const remoteID = (v: unknown): string => typeof v === 'string' && uuid.test(v) ? v : fail();
const mediaURL = (v: unknown): URL => {
  if (typeof v !== 'string' || /[\s\x00-\x1f\x7f\\]/.test(v)) return fail();
  const u = websiteURL(v, true);
  if (u.protocol !== 'https:' || new URL(v).hash) return fail();
  return u;
};
const retryAfter = (value: string | null): number | undefined => {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(3600, Math.ceil(seconds)) : undefined;
};

/** Server-only documented HTTP contract. No credentials or returned API URLs
 * reach the caller. Each method performs one request; durable retry/budget/tenant
 * authorization belongs to the job transaction, not this transport.
 *
 * The pinned JS SDK cannot expose per-instance redirect/response-byte limits or
 * explicit status/cancel. See ADR 0020 for the audited API transport decision.
 */
export function validHiggsfieldCredential(value:unknown):value is string {
 return typeof value==='string'&&value.length<=2048&&/^[\x21-\x39\x3b-\x7e]+(?::[\x21-\x39\x3b-\x7e]+)?$/.test(value);
}
export class HiggsfieldClient {
  #credentials: string;
  #base: URL;
  #models: Set<VideoModel>;
  #origins: Set<string>;
  #timeout: number;
  constructor(config: HiggsfieldConfig, private readonly transport: typeof fetch = fetch) {
    try {
      if (!['test', 'development', 'staging'].includes(config.mode) ||
          !validHiggsfieldCredential(config.credentials)) fail();
      this.#credentials = config.credentials;
      this.#base = new URL('https://api.higgsfield.ai');
      if (config.testBaseURL !== undefined) {
        const u = new URL(config.testBaseURL);
        if (config.mode !== 'test' || u.origin !== config.testBaseURL || u.protocol !== 'http:' ||
            !['127.0.0.1', '[::1]'].includes(u.hostname) || !u.port) fail();
        this.#base = u;
      }
      if (!Array.isArray(config.models) || !config.models.length || config.models.length > 2 ||
          config.models.some(m => !Object.values(HIGGSFIELD_MODELS).includes(m))) fail();
      this.#models = new Set(config.models);
      if (!Array.isArray(config.referenceOrigins) || !config.referenceOrigins.length || config.referenceOrigins.length > 10) fail();
      this.#origins = new Set(config.referenceOrigins.map(s => {
        const u = mediaURL(s); if (u.origin !== s) fail(); return u.origin;
      }));
      this.#timeout = config.timeoutMs ?? 30000;
      if (!Number.isInteger(this.#timeout) || this.#timeout < 10 || this.#timeout > 60000) fail();
    } catch { throw new HiggsfieldError('HIGGSFIELD_CONFIG_INVALID'); }
  }

  /** Persist this exact body, key and hash BEFORE submission. Signed reference
   * URL changes are parameter changes: never refresh one during a replay. */
  prepare(intent: VideoIntent) {
    try {
      record(intent);
      remoteID(intent.idempotencyKey);
      if (!this.#models.has(intent.model)) fail();
      if (typeof intent.prompt !== 'string' || !intent.prompt.trim() || intent.prompt.length > 10000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(intent.prompt)) fail();
      const reference = mediaURL(intent.referenceURL);
      if (!this.#origins.has(reference.origin)) fail();
      let body: Record<string, string | number | boolean | string[]>;
      let keys: string[];
      if (intent.kind === 'image' && intent.model === HIGGSFIELD_MODELS.image) {
        if (!Number.isInteger(intent.durationSeconds) || intent.durationSeconds < 3 || intent.durationSeconds > 15 || !['on', 'off'].includes(intent.sound)) fail();
        body = { prompt: intent.prompt, image_url: intent.referenceURL, duration: intent.durationSeconds,
          sound: intent.sound, cfg_scale: 0.5, multi_shots: false };
        keys = ['kind', 'model', 'idempotencyKey', 'referenceURL', 'prompt', 'durationSeconds', 'sound'];
      } else if (intent.kind === 'edit' && intent.model === HIGGSFIELD_MODELS.edit) {
        if (!['std', 'pro', '4k'].includes(intent.quality)) fail();
        body = { prompt: intent.prompt, video_urls: [intent.referenceURL], mode: intent.quality };
        keys = ['kind', 'model', 'idempotencyKey', 'referenceURL', 'prompt', 'quality'];
      } else return fail();
      if (Object.keys(intent).some(k => !keys.includes(k))) fail();
      const serialized = JSON.stringify(body);
      const sha256 = createHash('sha256').update(JSON.stringify({ model: intent.model, body })).digest('hex');
      return Object.freeze({ model: intent.model, idempotencyKey: intent.idempotencyKey, body: serialized, sha256 });
    } catch { throw new HiggsfieldError('HIGGSFIELD_INPUT_INVALID'); }
  }

  private async request(path: string, method: 'GET' | 'POST', body?: string, key?: string, cancel = false): Promise<unknown> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.#timeout);
    const outcome = method === 'POST' ? 'unknown' : 'not_sent';
    try {
      let response: Response;
      try {
        response = await this.transport(new URL(path, this.#base), {
          method, body, headers: { Authorization: `Key ${this.#credentials}`, Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(key === undefined ? {} : { 'Idempotency-Key': key }) },
          signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit',
        });
      } catch { throw new HiggsfieldError(controller.signal.aborted ? 'HIGGSFIELD_TIMEOUT' : 'HIGGSFIELD_NETWORK_ERROR', outcome); }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const rejected = [400, 401, 403, 404, 422, 429].includes(response.status);
        const code = response.status === 401 ? 'HIGGSFIELD_AUTH_REJECTED' :
          response.status === 403 ? 'HIGGSFIELD_ACCESS_OR_CREDITS_REJECTED' :
          response.status === 429 ? 'HIGGSFIELD_RATE_LIMITED' :
          response.status === 404 && method === 'GET' ? 'HIGGSFIELD_REQUEST_NOT_FOUND' :
          response.status === 422 ? 'HIGGSFIELD_PARAMETERS_REJECTED' :
          response.status === 400 && cancel ? 'HIGGSFIELD_CANCEL_REJECTED' :
          response.status >= 500 ? 'HIGGSFIELD_UNAVAILABLE' : 'HIGGSFIELD_REQUEST_REJECTED';
        throw new HiggsfieldError(code, rejected ? 'rejected' : outcome, retryAfter(response.headers.get('retry-after')));
      }
      try {
        if (cancel && response.status !== 202) fail();
        if (!cancel && !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) fail();
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > (cancel ? 0 : jsonLimit))) fail();
        const reader = response.body?.getReader();
        const parts: Uint8Array[] = []; let size = 0;
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read(); if (done) break;
              size += value.length; if (size > (cancel ? 0 : jsonLimit)) fail(); parts.push(value);
            }
          } finally { await reader.cancel().catch(() => {}); }
        }
        if (cancel) return null;
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
      } catch { await response.body?.cancel().catch(() => {}); throw new HiggsfieldError(controller.signal.aborted ? 'HIGGSFIELD_TIMEOUT' : 'HIGGSFIELD_RESPONSE_INVALID', outcome); }
    } finally { clearTimeout(timer); }
  }

  async submit(intent: VideoIntent, expectedSHA256: string): Promise<VideoReceipt> {
    const prepared = this.prepare(intent);
    if (prepared.sha256 !== expectedSHA256) throw new HiggsfieldError('HIGGSFIELD_REPLAY_MISMATCH');
    const value = await this.request(`/${prepared.model}`, 'POST', prepared.body, prepared.idempotencyKey);
    try {
      const r = record(value), id = remoteID(r.request_id);
      // An idempotency replay receipt can say queued after completion. Persist
      // its ID, then independently read current status. Ignore all returned URLs.
      return { requestId: id, statusURL: new URL(`/requests/${id}/status`, this.#base).href,
        cancelURL: new URL(`/requests/${id}/cancel`, this.#base).href };
    } catch { throw new HiggsfieldError('HIGGSFIELD_RECEIPT_INVALID', 'unknown'); }
  }

  async status(requestId: string): Promise<VideoObservation> {
    try { remoteID(requestId); } catch { throw new HiggsfieldError('HIGGSFIELD_REQUEST_ID_INVALID'); }
    const value = await this.request(`/requests/${requestId}/status`, 'GET');
    try {
      const r = record(value);
      if (remoteID(r.request_id) !== requestId || !['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'].includes(r.status as string)) fail();
      const state = r.status as VideoState;
      const videoURL = state === 'completed' ? mediaURL(record(r.video).url).href : null;
      // Do not surface provider error text: it can echo prompts, signed URLs or credentials.
      return { requestId, state, videoURL, errorCode: state === 'failed' ? 'HIGGSFIELD_GENERATION_FAILED' :
        state === 'nsfw' ? 'HIGGSFIELD_MODERATION_REJECTED' : null };
    } catch { throw new HiggsfieldError('HIGGSFIELD_RESPONSE_INVALID'); }
  }

  async cancel(requestId: string): Promise<{ requestId: string; state: 'cancel_requested' }> {
    try { remoteID(requestId); } catch { throw new HiggsfieldError('HIGGSFIELD_REQUEST_ID_INVALID'); }
    await this.request(`/requests/${requestId}/cancel`, 'POST', undefined, undefined, true);
    // Acknowledgement is not final cancellation or a refund. Reconcile status.
    return { requestId, state: 'cancel_requested' };
  }
}
