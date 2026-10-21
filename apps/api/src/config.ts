export type Config = {
  mode: 'development' | 'test' | 'staging' | 'production';
  origin: string;
  authSecret: string;
  authDatabaseUrl: string;
  appDatabaseUrl: string;
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
  // Mail verification/recovery must be wired before external signup is enabled.
  if (['staging', 'production'].includes(mode!)) throw new Error('External auth launch blocked: verified email delivery and recovery are not implemented');
  return { mode: mode as Config['mode'], origin: origin.origin, authSecret: secret,
    authDatabaseUrl: required('AUTH_DATABASE_URL'), appDatabaseUrl: required('APP_DATABASE_URL') };
}
