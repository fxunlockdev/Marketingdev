import {isAuthenticatedVideoOutput,type AuthenticatedVideoOutput} from './video-output.js';
import { createHash } from 'node:crypto';
import { SafeWeb, websiteURL } from './safe-web.js';
import {MAX_CANONICAL_VIDEO_BYTES} from './object-store.js';

export const MAX_VIDEO_DOWNLOAD_BYTES = MAX_CANONICAL_VIDEO_BYTES;
export class VideoDownloadError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'VideoDownloadError'; }
}
const checkedURL = (value: string) => {
  if (typeof value !== 'string' || /[\s\x00-\x1f\x7f\\]/.test(value)) throw new Error();
  const url = websiteURL(value, true);
  if (url.protocol !== 'https:' || new URL(value).hash) throw new Error();
  return url;
};

/** Credentials-free, bounded fetch of untrusted provider output. This is NOT a
 * decoder, a saved creative, or a publishable asset. A network-disabled media
 * sandbox must fully decode/re-encode it before canonical private persistence. */
export class VideoDownload {
  #origins: Set<string>;
  constructor(origins: string[], private readonly web = new SafeWeb(), private readonly policy: 'exact_origins'|'authenticated_provider_result' = 'exact_origins') {
    try {
      if (!['exact_origins','authenticated_provider_result'].includes(policy) || !Array.isArray(origins) || (!origins.length && policy==='exact_origins') || origins.length > 10 || (policy==='authenticated_provider_result' && origins.length)) throw new Error();
      this.#origins = new Set(origins.map(value => {
        const url = checkedURL(value); if (url.origin !== value) throw new Error(); return url.origin;
      }));
    } catch { throw new VideoDownloadError('VIDEO_DOWNLOAD_CONFIG_INVALID'); }
  }
  async read(remoteURL: string): Promise<{ state: 'untrusted_video'; bytes: Buffer; sha256: string }> {
    return this.fetchOutput(remoteURL,false);
  }
  async readProviderOutput(output: AuthenticatedVideoOutput) {
    if(!isAuthenticatedVideoOutput(output))throw new VideoDownloadError('VIDEO_OUTPUT_PROVENANCE_REQUIRED');
    return this.fetchOutput(output.url,true);
  }
  private async fetchOutput(remoteURL:string,authenticated:boolean):Promise<{ state:'untrusted_video';bytes:Buffer;sha256:string }> {
    let url: URL;
    try { url = checkedURL(remoteURL); if (!(authenticated && this.policy==='authenticated_provider_result') && !this.#origins.has(url.origin)) throw new Error(); }
    catch { throw new VideoDownloadError('VIDEO_DOWNLOAD_URL_BLOCKED'); }
    let response;
    try {
      // SafeWeb checks every DNS answer and pins the connection to a public IP,
      // validates TLS, never follows redirects and never sends provider secrets.
      response = await this.web.fetch(url, MAX_VIDEO_DOWNLOAD_BYTES, 'video/mp4');
    } catch { throw new VideoDownloadError('VIDEO_DOWNLOAD_FAILED'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) throw new VideoDownloadError('VIDEO_DOWNLOAD_REDIRECT_BLOCKED');
    if (response.status !== 200) throw new VideoDownloadError('VIDEO_DOWNLOAD_HTTP_ERROR');
    const type = response.headers['content-type'], encoding = response.headers['content-encoding'];
    const length = response.headers['content-length'];
    if (typeof type !== 'string' || !/^video\/mp4(?:\s*;|$)/i.test(type) || encoding && encoding !== 'identity' ||
        length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) !== response.bytes.length) ||
        !Buffer.isBuffer(response.bytes) || response.bytes.length < 24 || response.bytes.length > MAX_VIDEO_DOWNLOAD_BYTES) {
      throw new VideoDownloadError('VIDEO_DOWNLOAD_INVALID');
    }
    return { state: 'untrusted_video', bytes: response.bytes, sha256: createHash('sha256').update(response.bytes).digest('hex') };
  }
}
