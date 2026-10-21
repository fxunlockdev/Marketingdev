import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import type { Config } from './config.js';

export function authOptions(pool: Pool, config: Config) {
  return {
    appName: 'Desvio', baseURL: config.origin, basePath: '/api/auth',
    secret: config.authSecret, database: pool,
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      requireEmailVerification: config.mode !== 'development' && config.mode !== 'test' },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database' as const, window: 60, max: 60 },
    advanced: { useSecureCookies: config.origin.startsWith('https:'),
      // Set by our ingress from the socket, overwriting any caller-supplied value.
      ipAddress: { ipAddressHeaders: ['x-desvio-peer-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' as const },
      database: { generateId: 'uuid' as const } },
    logger: { disabled: true },
  };
}

export function createAuth(pool: Pool, config: Config) { return betterAuth(authOptions(pool, config)); }
export type Auth = ReturnType<typeof createAuth>;
