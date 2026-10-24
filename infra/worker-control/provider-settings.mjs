import {validHiggsfieldCredential} from '../../dist/higgsfield-client.js';
import {VideoDownload} from '../../dist/video-download.js';
// Railway settings are operator input, never authority to replace infrastructure credentials.
const keys = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'HIGGSFIELD_CREDENTIALS'];
export function providerSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_PROVIDER_SETTINGS');
  const output = {};
  for (const key of keys) {
    const value = input[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value) || value !== value.trim()) {
      throw Error('INVALID_PROVIDER_SETTINGS');
    }
    output[key] = value;
  }
  return output;
}

// An explicit operator switch is required. Merely adding a paid credential cannot enable video.
export function providerRuntimeSettings(input){
 const credentials=providerSettings(input),enabled=input.VIDEO_ENABLED??'false';
 if(!['true','false'].includes(enabled))throw Error('INVALID_VIDEO_SETTINGS');
 if(enabled==='false')return {...credentials,VIDEO_ENABLED:'false'};
 try{
  if(!credentials.OPENAI_API_KEY&&!credentials.GEMINI_API_KEY)throw Error();
  if(!validHiggsfieldCredential(credentials.HIGGSFIELD_CREDENTIALS))throw Error();
  if(!/^[a-f0-9]{64}$/i.test(input.VIDEO_ENCRYPTION_KEY??''))throw Error();
  const policy=input.HIGGSFIELD_OUTPUT_POLICY??'exact_origins';
  if(!['exact_origins','authenticated_provider_result'].includes(policy))throw Error();
  if(policy==='authenticated_provider_result'){
   if(input.HIGGSFIELD_OUTPUT_ORIGINS)throw Error();
   new VideoDownload([],undefined,policy);
   return {...credentials,VIDEO_ENABLED:'true',VIDEO_ENCRYPTION_KEY:input.VIDEO_ENCRYPTION_KEY,HIGGSFIELD_OUTPUT_POLICY:policy};
  }
  if(typeof input.HIGGSFIELD_OUTPUT_ORIGINS!=='string'||input.HIGGSFIELD_OUTPUT_ORIGINS.length>4096)throw Error();
  const origins=input.HIGGSFIELD_OUTPUT_ORIGINS.split(',');
  if(new Set(origins).size!==origins.length||origins.some(origin=>origin.includes('*')))throw Error();
  new VideoDownload(origins); // Reuse the real downloader's exact-origin/SSRF configuration rules.
  return {...credentials,VIDEO_ENABLED:'true',VIDEO_ENCRYPTION_KEY:input.VIDEO_ENCRYPTION_KEY,HIGGSFIELD_OUTPUT_ORIGINS:origins.join(',')};
 }catch{throw Error('INVALID_VIDEO_SETTINGS');}
}
