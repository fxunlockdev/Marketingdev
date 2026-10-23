import {mailConfig} from './mail-config.js';
import type {SocialWorkerConfig} from './social-jobs.js';
export type StorageConfig={endpoint:string;region:string;bucket:string;accessKeyId:string;secretAccessKey:string};
export type ScannerConfig={host:string;port:number};
export type JobsConfig={workerDatabaseUrl:string;dispatcherDatabaseUrl:string;address:string;namespace:string;taskQueue:string};
export type Config = {
  mode: 'development' | 'test' | 'staging' | 'production';
  origin: string;
  authSecret: string;
  authDatabaseUrl: string;
  appDatabaseUrl: string;
  mailDatabaseUrl: string;
  mailEncryptionKey: string;
  smtp: {host:string;port:number;secure:boolean;user?:string;password?:string;from:string};
  storage: StorageConfig;
  renderImage?:string;
  videoRenderImage?:string;
  videoEnabled?:boolean;
  socialEnabled?:boolean;
  publishingEnabled?:boolean;
  oauthEncryptionKey?:string;
  socialProvisioningEnabled?:boolean;
};

export function configFromEnv(env = process.env): Config {
  const mode = env.APP_MODE;
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
  const mailEncryptionKey=required('MAIL_ENCRYPTION_KEY');
  if(!/^[a-f0-9]{64}$/i.test(mailEncryptionKey)) throw new Error('MAIL_ENCRYPTION_KEY must be 32 random bytes as hex');
  const smtp=mailConfig(env,mode!);
  const storage=storageFromEnv(env);
  const renderImage=env.RENDER_RUNTIME_IMAGE;if(renderImage&&!/^sha256:[a-f0-9]{64}$/.test(renderImage))throw new Error('RENDER_RUNTIME_IMAGE must be an exact local image digest');
  if(env.POSTIZ_ENABLED!==undefined&&!['true','false'].includes(env.POSTIZ_ENABLED))throw new Error('POSTIZ_ENABLED must be true or false');
  const oauthEncryptionKey=env.OAUTH_ENCRYPTION_KEY;if(oauthEncryptionKey&&!/^[a-f0-9]{64}$/i.test(oauthEncryptionKey))throw new Error('OAUTH_ENCRYPTION_KEY must be 32 random bytes as hex');
  if(env.POSTIZ_PROVISIONING_ENABLED!==undefined&&!['true','false'].includes(env.POSTIZ_PROVISIONING_ENABLED))throw new Error('POSTIZ_PROVISIONING_ENABLED must be true or false');
  const videoRenderImage=env.VIDEO_RUNTIME_IMAGE;if(videoRenderImage&&!/^sha256:[a-f0-9]{64}$/.test(videoRenderImage))throw new Error('VIDEO_RUNTIME_IMAGE must be an exact local image digest');
  return {videoRenderImage,videoEnabled:env.VIDEO_ENABLED==='true',publishingEnabled:env.POSTIZ_PUBLISHING_ENABLED==='true',socialProvisioningEnabled:env.POSTIZ_PROVISIONING_ENABLED==='true',oauthEncryptionKey,renderImage,socialEnabled:env.POSTIZ_ENABLED==='true', mode: mode as Config['mode'], origin: origin.origin, authSecret: secret,
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
  const documentImage=env.DOCUMENT_PARSER_IMAGE;if(documentImage&&!/^sha256:[a-f0-9]{64}$/.test(documentImage))throw new Error('DOCUMENT_PARSER_IMAGE must be an exact local image digest');
  const skillImage=env.SKILL_RUNTIME_IMAGE;if(skillImage&&!/^sha256:[a-f0-9]{64}$/.test(skillImage))throw new Error('SKILL_RUNTIME_IMAGE must be an exact local image digest');
  const renderImage=env.RENDER_RUNTIME_IMAGE;if(renderImage&&!/^sha256:[a-f0-9]{64}$/.test(renderImage))throw new Error('RENDER_RUNTIME_IMAGE must be an exact local image digest');
  if(env.POSTIZ_ENABLED!==undefined&&!['true','false'].includes(env.POSTIZ_ENABLED))throw new Error('POSTIZ_ENABLED must be true or false');
  const social:SocialWorkerConfig|undefined=env.POSTIZ_ENABLED==='true'?{client:{baseURL:required('POSTIZ_BASE_URL'),mediaOrigins:required('POSTIZ_MEDIA_ORIGINS').split(','),callbackOrigin:required('POSTIZ_CALLBACK_ORIGIN'),mode:mode as 'test'|'development'|'staging'},encryptionKey:required('POSTIZ_ENCRYPTION_KEY')}:undefined;
  const oauthEncryptionKey=env.OAUTH_ENCRYPTION_KEY;if(oauthEncryptionKey&&!/^[a-f0-9]{64}$/i.test(oauthEncryptionKey))throw new Error('OAUTH_ENCRYPTION_KEY must be 32 random bytes as hex');
  if(oauthEncryptionKey&&oauthEncryptionKey===social?.encryptionKey)throw new Error('OAuth and Postiz credentials require separate keys');
  const provisionTaskQueue=env.POSTIZ_PROVISION_TASK_QUEUE;if(provisionTaskQueue&&(!/^[A-Za-z0-9_.:-]{1,100}$/.test(provisionTaskQueue)||provisionTaskQueue===jobs.taskQueue))throw new Error('Provisioning requires a separate task queue');
  if(env.VIDEO_ENABLED!==undefined&&!['true','false'].includes(env.VIDEO_ENABLED))throw new Error('VIDEO_ENABLED must be true or false');
  const video=env.VIDEO_ENABLED==='true'?{mode:mode as 'test'|'development'|'staging',image:required('VIDEO_RUNTIME_IMAGE'),encryptionKey:required('VIDEO_ENCRYPTION_KEY'),credentials:required('HIGGSFIELD_CREDENTIALS'),outputOrigins:required('HIGGSFIELD_OUTPUT_ORIGINS').split(',')}:undefined;
  if(video&&(!/^sha256:[a-f0-9]{64}$/.test(video.image)||!/^sha256:[a-f0-9]{64}$/.test(renderImage??'')||!skillImage||(!env.OPENAI_API_KEY&&!env.GEMINI_API_KEY)||!/^[a-f0-9]{64}$/i.test(video.encryptionKey)))throw new Error('Video requires pinned renderers, skills, model credentials and a 32-byte encryption key');
  if(video&&[oauthEncryptionKey,social?.encryptionKey].includes(video.encryptionKey))throw new Error('Video requires a separate encryption key');
  const videoRenderImage=env.VIDEO_RUNTIME_IMAGE;if(videoRenderImage&&!/^sha256:[a-f0-9]{64}$/.test(videoRenderImage))throw new Error('VIDEO_RUNTIME_IMAGE must be an exact local image digest');
  return {videoRenderImage,video,publishingEnabled:env.POSTIZ_PUBLISHING_ENABLED==='true',storage:storageFromEnv(env),scanner,jobs,documentImage,skillImage,renderImage,social,oauthEncryptionKey,provisionTaskQueue};
}

// Deliberately independent of storage, authentication, SMTP and model settings.
export function provisionerConfigFromEnv(env=process.env){
 const required=envReader(env),mode=required('APP_MODE');if(!['development','test','staging'].includes(mode))throw new Error('Provisioner production launch blocked pending release gate');
 const taskQueue=required('POSTIZ_PROVISION_TASK_QUEUE');if(!/^[A-Za-z0-9_.:-]{1,100}$/.test(taskQueue)||taskQueue===env.TEMPORAL_TASK_QUEUE)throw new Error('Provisioning requires a separate task queue');
 const encryptionKey=required('POSTIZ_ENCRYPTION_KEY'),signingSecret=required('POSTIZ_ENTERPRISE_SIGNING_SECRET');if(!/^[a-f0-9]{64}$/i.test(encryptionKey)||signingSecret.length<32||encryptionKey===signingSecret||encryptionKey===env.OAUTH_ENCRYPTION_KEY)throw new Error('Provisioning requires distinct valid encryption and signing secrets');
 return {databaseUrl:required('POSTIZ_PROVISIONER_DATABASE_URL'),address:required('TEMPORAL_ADDRESS'),namespace:required('TEMPORAL_NAMESPACE'),taskQueue,provider:{client:{baseURL:required('POSTIZ_BASE_URL'),mediaOrigins:required('POSTIZ_MEDIA_ORIGINS').split(','),callbackOrigin:required('POSTIZ_CALLBACK_ORIGIN'),mode:mode as 'test'|'development'|'staging'},encryptionKey,signingSecret}};
}
