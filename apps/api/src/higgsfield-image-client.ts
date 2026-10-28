import { createHash } from 'node:crypto';
import { websiteURL } from './safe-web.js';

export const HIGGSFIELD_IMAGE_MODEL = 'higgsfield-ai/soul/v2/standard' as const;
export type StillIntent = {model:typeof HIGGSFIELD_IMAGE_MODEL;idempotencyKey:string;prompt:string;aspect:'1:1'|'2:3'|'3:2'|'9:16'};
export type StillState='queued'|'in_progress'|'completed'|'failed'|'nsfw'|'canceled';
export class HiggsfieldImageError extends Error {
 constructor(readonly code:string,readonly outcome:'not_sent'|'rejected'|'unknown'='not_sent',readonly retryAfterSeconds?:number){super(code);this.name='HiggsfieldImageError';}
}
export type HiggsfieldImageConfig={credentials:string;timeoutMs?:number;testBaseURL?:string;mode:'test'|'development'|'staging'};
export type StillReceipt={requestId:string;statusURL:string;cancelURL:string};
export type StillObservation={requestId:string;state:StillState;imageURL:string|null;errorCode:string|null};
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
 * reach the caller. Soul2 text-to-image, one1080p background; never stock-search results. Each method performs one request; durable retry/budget/tenant
 * authorization belongs to the job transaction, not this transport.
 *
 * The pinned JS SDK cannot expose per-instance redirect/response-byte limits or
 * explicit status/cancel. See ADR 0020 for the audited API transport decision.
 */
export function validHiggsfieldCredential(value:unknown):value is string {
 return typeof value==='string'&&value.length<=2048&&/^[\x21-\x39\x3b-\x7e]+(?::[\x21-\x39\x3b-\x7e]+)?$/.test(value);
}
export class HiggsfieldImageClient {
  #credentials: string;
  #base: URL;
  #timeout: number;
  constructor(config: HiggsfieldImageConfig, private readonly transport: typeof fetch = fetch) {
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
      this.#timeout = config.timeoutMs ?? 30000;
      if (!Number.isInteger(this.#timeout) || this.#timeout < 10 || this.#timeout > 60000) fail();
    } catch { throw new HiggsfieldImageError('HIGGSFIELD_CONFIG_INVALID'); }
  }

  /** Persist this exact body, key and hash BEFORE submission. Signed reference
   * URL changes are parameter changes: never refresh one during a replay. */
  prepare(intent: StillIntent) {
    try {
      record(intent);
      remoteID(intent.idempotencyKey);
      if(intent.model!==HIGGSFIELD_IMAGE_MODEL||typeof intent.prompt!=='string'||!intent.prompt.trim()||intent.prompt.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(intent.prompt)||!['1:1','2:3','3:2','9:16'].includes(intent.aspect))fail();
      if(Object.keys(intent).sort().join(',')!=='aspect,idempotencyKey,model,prompt')fail();
      const body={prompt:intent.prompt,aspect_ratio:intent.aspect,resolution:'1080p',batch_size:1,enhance_prompt:false};
      const serialized = JSON.stringify(body);
      const sha256 = createHash('sha256').update(JSON.stringify({ model: intent.model, body })).digest('hex');
      return Object.freeze({ model: intent.model, idempotencyKey: intent.idempotencyKey, body: serialized, sha256 });
    } catch { throw new HiggsfieldImageError('HIGGSFIELD_INPUT_INVALID'); }
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
      } catch { throw new HiggsfieldImageError(controller.signal.aborted ? 'HIGGSFIELD_TIMEOUT' : 'HIGGSFIELD_NETWORK_ERROR', outcome); }
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
        throw new HiggsfieldImageError(code, rejected ? 'rejected' : outcome, retryAfter(response.headers.get('retry-after')));
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
      } catch { await response.body?.cancel().catch(() => {}); throw new HiggsfieldImageError(controller.signal.aborted ? 'HIGGSFIELD_TIMEOUT' : 'HIGGSFIELD_RESPONSE_INVALID', outcome); }
    } finally { clearTimeout(timer); }
  }

  async estimate(intent:StillIntent):Promise<number>{
    const p=this.prepare(intent);let r:Record<string,unknown>;
    const value=await this.request(`/estimate/${p.model}`,'POST',p.body);
    try{r=record(value);}catch{throw new HiggsfieldImageError('HIGGSFIELD_ESTIMATE_INVALID');}
    if(typeof r.usd!=='string'||!/^\d+(?:\.\d{1,6})?$/.test(r.usd))throw new HiggsfieldImageError('HIGGSFIELD_ESTIMATE_INVALID');
    const micros=Math.round(Number(r.usd)*1000000);
    if(!Number.isSafeInteger(micros)||micros<1||micros>100000000)throw new HiggsfieldImageError('HIGGSFIELD_ESTIMATE_INVALID');
    return micros;
  }

  async submit(intent: StillIntent, expectedSHA256: string): Promise<StillReceipt> {
    const prepared = this.prepare(intent);
    if (prepared.sha256 !== expectedSHA256) throw new HiggsfieldImageError('HIGGSFIELD_REPLAY_MISMATCH');
    const value = await this.request(`/${prepared.model}`, 'POST', prepared.body, prepared.idempotencyKey);
    try {
      const r = record(value), id = remoteID(r.request_id);
      // An idempotency replay receipt can say queued after completion. Persist
      // its ID, then independently read current status. Ignore all returned URLs.
      return { requestId: id, statusURL: new URL(`/requests/${id}/status`, this.#base).href,
        cancelURL: new URL(`/requests/${id}/cancel`, this.#base).href };
    } catch { throw new HiggsfieldImageError('HIGGSFIELD_RECEIPT_INVALID', 'unknown'); }
  }

  async status(requestId: string): Promise<StillObservation> {
    try { remoteID(requestId); } catch { throw new HiggsfieldImageError('HIGGSFIELD_REQUEST_ID_INVALID'); }
    const value = await this.request(`/requests/${requestId}/status`, 'GET');
    try {
      const r = record(value);
      if (remoteID(r.request_id) !== requestId || !['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'].includes(r.status as string)) fail();
      const state = r.status as StillState;
      const imageURL = state === 'completed' ? (Array.isArray(r.images)&&r.images.length===1?mediaURL(record(r.images[0]).url).href:fail()) : null;
      // Do not surface provider error text: it can echo prompts, signed URLs or credentials.
      return { requestId, state, imageURL, errorCode: state === 'failed' ? 'HIGGSFIELD_GENERATION_FAILED' :
        state === 'nsfw' ? 'HIGGSFIELD_MODERATION_REJECTED' : null };
    } catch { throw new HiggsfieldImageError('HIGGSFIELD_RESPONSE_INVALID'); }
  }

  async cancel(requestId: string): Promise<{ requestId: string; state: 'cancel_requested' }> {
    try { remoteID(requestId); } catch { throw new HiggsfieldImageError('HIGGSFIELD_REQUEST_ID_INVALID'); }
    await this.request(`/requests/${requestId}/cancel`, 'POST', undefined, undefined, true);
    // Acknowledgement is not final cancellation or a refund. Reconcile status.
    return { requestId, state: 'cancel_requested' };
  }
}
