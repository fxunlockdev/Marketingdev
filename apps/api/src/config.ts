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
};

export function configFromEnv(env = process.env): Config {
  const mode = env.APP_MODE;
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
  const smtp={host:required('SMTP_HOST'),port:Number(required('SMTP_PORT')),secure:env.SMTP_SECURE==='true',
    user:env.SMTP_USER,password:env.SMTP_PASSWORD,from:required('SMTP_FROM')};
  if(!Number.isInteger(smtp.port) || smtp.port<1 || smtp.port>65535) throw new Error('Invalid SMTP port');
  if(env.SMTP_SECURE!==undefined && !['true','false'].includes(env.SMTP_SECURE)) throw new Error('SMTP_SECURE must be true or false');
  if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(smtp.from)) throw new Error('SMTP_FROM must be a single email address');
  if(mode==='staging' && (!smtp.user || !smtp.password)) throw new Error('Authenticated SMTP required for staging');
  const storage=storageFromEnv(env);
  return { mode: mode as Config['mode'], origin: origin.origin, authSecret: secret,
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
  return {storage:storageFromEnv(env),scanner,jobs,documentImage};
}
