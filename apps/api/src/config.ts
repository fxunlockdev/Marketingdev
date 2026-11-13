import {mockServerOrigin} from './agent-reach-sandbox.js';
import {configuredPostformePlatforms} from './postforme-client.js';
import {validIngressSecret} from './auth-ingress.js';
import {mailConfig} from './mail-config.js';
export type StorageConfig={endpoint:string;region:string;bucket:string;accessKeyId:string;secretAccessKey:string};
export type ScannerConfig={host:string;port:number};
export type JobsConfig={workerDatabaseUrl:string;dispatcherDatabaseUrl:string;address:string;namespace:string;taskQueue:string};
export type Config = {
  mode: 'development' | 'test' | 'staging' | 'production';
  origin: string;
  authSecret: string;
  authIngressSecret?: string;
  authDatabaseUrl: string;
  appDatabaseUrl: string;
  mailDatabaseUrl: string;
  mailEncryptionKey: string;
  pexelsApiKey?:string;
  higgsfieldImagesEnabled?:boolean;
  publicSignupEnabled?:boolean;
  smtp?: {host:string;port:number;secure:boolean;user?:string;password?:string;from:string};
  storage: StorageConfig;
  renderImage?:string;
  videoRenderImage?:string;
  videoEnabled?:boolean;
  postformeApiKey?:string;
  postformePlatforms?:string[];
  postformePublishingEnabled?:boolean;
};

export function configFromEnv(env = process.env): Config {
  const mode = env.APP_MODE;
  for(const flag of ['POSTFORME_ENABLED','POSTFORME_PUBLISHING_ENABLED','PUBLIC_SIGNUP_ENABLED'])if(env[flag]!==undefined&&!['true','false'].includes(env[flag]!))throw new Error(`${flag} must be true or false`);
  if(env.POSTFORME_ENABLED==='true'&&!env.POSTFORME_API_KEY?.trim())throw new Error('POSTFORME_API_KEY is required when Postforme is enabled');
  if(env.POSTFORME_PUBLISHING_ENABLED==='true'&&env.POSTFORME_ENABLED!=='true')throw new Error('Postforme publishing requires Postforme connections');
  if(env.VIDEO_ENABLED!==undefined&&!['true','false'].includes(env.VIDEO_ENABLED))throw new Error('VIDEO_ENABLED must be true or false');
  if (!['development', 'test', 'staging', 'production'].includes(mode ?? '')) throw new Error('APP_MODE is required');
  const required = (key: string) => {
    if (!env[key]) throw new Error(`${key} is required`);
    return env[key]!;
  };
  const origin = new URL(required('APP_ORIGIN'));
  if (origin.origin !== env.APP_ORIGIN) throw new Error('APP_ORIGIN must be an exact origin without a path');
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Unsupported origin scheme');
  if (['staging', 'production'].includes(mode!) && origin.protocol !== 'https:') throw new Error('HTTPS required');
  if (origin.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) throw new Error('Insecure origin must be loopback');
  const secret = required('AUTH_SECRET');
  if (secret.length < 32) throw new Error('AUTH_SECRET must have at least 32 characters');
  if(mode==='production') throw new Error('Production launch blocked pending the complete release gate');
  const authIngressSecret=env.AUTH_INGRESS_SECRET;
  if(authIngressSecret!==undefined&&(!validIngressSecret(authIngressSecret)||authIngressSecret===secret))throw new Error('AUTH_INGRESS_SECRET must be a separate 32-byte hex secret');
  const mailEncryptionKey=required('MAIL_ENCRYPTION_KEY');
  if(!/^[a-f0-9]{64}$/i.test(mailEncryptionKey)) throw new Error('MAIL_ENCRYPTION_KEY must be 32 random bytes as hex');
  const smtp=mailConfig(env,mode!);
  const storage=storageFromEnv(env);
  const renderImage=env.RENDER_RUNTIME_IMAGE;if(renderImage&&!/^sha256:[a-f0-9]{64}$/.test(renderImage))throw new Error('RENDER_RUNTIME_IMAGE must be an exact local image digest');
  const videoRenderImage=env.VIDEO_RUNTIME_IMAGE;if(videoRenderImage&&!/^sha256:[a-f0-9]{64}$/.test(videoRenderImage))throw new Error('VIDEO_RUNTIME_IMAGE must be an exact local image digest');
  return {postformePlatforms:configuredPostformePlatforms(env.POSTFORME_PLATFORMS),publicSignupEnabled:env.PUBLIC_SIGNUP_ENABLED==='true',postformeApiKey:env.POSTFORME_ENABLED==='true'?env.POSTFORME_API_KEY?.trim():undefined,postformePublishingEnabled:env.POSTFORME_PUBLISHING_ENABLED==='true',higgsfieldImagesEnabled:env.HIGGSFIELD_IMAGES_ENABLED==='true',pexelsApiKey:env.PEXELS_API_KEY?.trim()||undefined,videoRenderImage,videoEnabled:env.VIDEO_ENABLED==='true',renderImage, mode: mode as Config['mode'], origin: origin.origin, authSecret: secret, authIngressSecret,
    authDatabaseUrl: required('AUTH_DATABASE_URL'), appDatabaseUrl: required('APP_DATABASE_URL'),
    mailDatabaseUrl:required('MAIL_DATABASE_URL'),mailEncryptionKey,smtp,storage };
}

function envReader(env:NodeJS.ProcessEnv){return (key:string)=>{if(!env[key])throw new Error(`${key} is required`);return env[key]!;};}
function storageFromEnv(env:NodeJS.ProcessEnv):StorageConfig{
  const required=envReader(env);
  const endpoint=new URL(required('S3_ENDPOINT'));
  if(endpoint.username || endpoint.password || !['http:','https:'].includes(endpoint.protocol)
    || (endpoint.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) throw new Error('S3 requires HTTPS or local test storage');
  const storage={endpoint:endpoint.toString(),region:required('S3_REGION'),bucket:required('S3_BUCKET'),accessKeyId:required('S3_ACCESS_KEY_ID'),secretAccessKey:required('S3_SECRET_ACCESS_KEY')};
  return storage;
}
// Worker processes do not require or read authentication, application DB or SMTP credentials.
export function workerConfigFromEnv(env=process.env){
  const required=envReader(env),mode=required('APP_MODE');
  if(!['test','development','staging'].includes(mode))throw new Error('Worker production launch blocked pending the complete release gate');
  const scanner={host:required('CLAMD_HOST'),port:Number(required('CLAMD_PORT'))};
  if(!Number.isInteger(scanner.port)||scanner.port<1||scanner.port>65535)throw new Error('Invalid scanner port');
  const jobs={workerDatabaseUrl:required('WORKER_DATABASE_URL'),dispatcherDatabaseUrl:required('DISPATCHER_DATABASE_URL'),address:required('TEMPORAL_ADDRESS'),namespace:required('TEMPORAL_NAMESPACE'),taskQueue:required('TEMPORAL_TASK_QUEUE')};
  const websiteRenderImage=env.WEBSITE_RENDER_IMAGE;if(websiteRenderImage!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(websiteRenderImage))throw new Error('WEBSITE_RENDER_IMAGE must be an exact local image digest');
  const documentImage=env.DOCUMENT_PARSER_IMAGE;if(documentImage&&!/^sha256:[a-f0-9]{64}$/.test(documentImage))throw new Error('DOCUMENT_PARSER_IMAGE must be an exact local image digest');
  const skillImage=env.SKILL_RUNTIME_IMAGE;if(skillImage&&!/^sha256:[a-f0-9]{64}$/.test(skillImage))throw new Error('SKILL_RUNTIME_IMAGE must be an exact local image digest');
  const renderImage=env.RENDER_RUNTIME_IMAGE;if(renderImage&&!/^sha256:[a-f0-9]{64}$/.test(renderImage))throw new Error('RENDER_RUNTIME_IMAGE must be an exact local image digest');
  if(env.VIDEO_ENABLED!==undefined&&!['true','false'].includes(env.VIDEO_ENABLED))throw new Error('VIDEO_ENABLED must be true or false');
  const outputPolicy=env.RUNWAY_OUTPUT_POLICY??'authenticated_provider_result';
  if(!['exact_origins','authenticated_provider_result'].includes(outputPolicy))throw new Error('Invalid video output policy');
  if(outputPolicy==='authenticated_provider_result'&&env.RUNWAY_OUTPUT_ORIGINS)throw new Error('Conflicting video output settings');
  if(env.HIGGSFIELD_IMAGES_ENABLED!==undefined&&!['true','false'].includes(env.HIGGSFIELD_IMAGES_ENABLED))throw new Error('Invalid image replacement flag');
  const higgsfieldImages=env.HIGGSFIELD_IMAGES_ENABLED==='true'?{mode:mode as 'test'|'development'|'staging',credentials:required('HIGGSFIELD_CREDENTIALS'),encryptionKey:required('HIGGSFIELD_IMAGE_ENCRYPTION_KEY')}:undefined;
  if(higgsfieldImages&&(!/^[a-f0-9]{64}$/i.test(higgsfieldImages.encryptionKey)||higgsfieldImages.encryptionKey===env.VIDEO_ENCRYPTION_KEY))throw new Error('Image replacements require a separate 32-byte encryption key');
  const video=env.VIDEO_ENABLED==='true'?{mode:mode as 'test'|'development'|'staging',image:required('VIDEO_RUNTIME_IMAGE'),encryptionKey:required('VIDEO_ENCRYPTION_KEY'),credentials:required('RUNWAYML_API_SECRET'),outputPolicy:outputPolicy as 'exact_origins'|'authenticated_provider_result',outputOrigins:outputPolicy==='exact_origins'?required('RUNWAY_OUTPUT_ORIGINS').split(','):[]}:undefined;
  if(video&&(!/^sha256:[a-f0-9]{64}$/.test(video.image)||!/^sha256:[a-f0-9]{64}$/.test(renderImage??'')||!skillImage||(!env.OPENAI_API_KEY&&!env.GEMINI_API_KEY)||!/^[a-f0-9]{64}$/i.test(video.encryptionKey)))throw new Error('Video requires pinned renderers, skills, model credentials and a 32-byte encryption key');
  const videoRenderImage=env.VIDEO_RUNTIME_IMAGE;if(videoRenderImage&&!/^sha256:[a-f0-9]{64}$/.test(videoRenderImage))throw new Error('VIDEO_RUNTIME_IMAGE must be an exact local image digest');
  return {agentReach:agentReachFromEnv(env,mode),higgsfieldImages,websiteRenderImage,videoRenderImage,video,storage:storageFromEnv(env),scanner,jobs,documentImage,skillImage,renderImage};
}

/** Agent Reach research (login-free web search, page reads, YouTube). On by default in development
 * and test, off unless AGENT_REACH_ENABLED=true in staging. It runs in the pinned sandbox image
 * (AGENT_REACH_IMAGE) or, in development and test only, against the loopback mock. */
export function agentReachFromEnv(env:NodeJS.ProcessEnv,mode:string):{enabled:boolean;image?:string;mockOrigin?:string}{
  const flag=env.AGENT_REACH_ENABLED;
  if(flag!==undefined&&!['true','false'].includes(flag))throw new Error('AGENT_REACH_ENABLED must be true or false');
  const enabled=flag===undefined?['development','test'].includes(mode):flag==='true';
  const image=env.AGENT_REACH_IMAGE;if(image!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('AGENT_REACH_IMAGE must be an exact local image digest');
  const mockOrigin=mockServerOrigin(env.AGENT_REACH_MOCK_URL,mode);
  return {enabled,...(image?{image}:{}),...(mockOrigin?{mockOrigin}:{})};
}
