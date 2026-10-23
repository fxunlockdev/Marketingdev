import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import { PostgresDialect } from 'kysely';
import type { MailQueue } from './mail.js';

export function authOptions(pool: Pool, config: Config, mail?: MailQueue) {
  const enqueue=async(kind:'verify'|'reset',to:string,url:string)=>{
    if(!mail) throw new Error('Email queue unavailable');
    await mail.enqueue(pool,kind,{to,url},new Date(Date.now()+30*60*1000));
  };
  return {
    plugins: [twoFactor({issuer:'Desvio',skipVerificationOnEnable:false,allowPasswordless:false,accountLockout:{enabled:true,maxFailedAttempts:5,durationSeconds:900},backupCodeOptions:{storeBackupCodes:'encrypted'}})],
    appName: 'Desvio', baseURL: config.origin, basePath: '/api/auth',
    secret: config.authSecret, database: {dialect:new PostgresDialect({pool}),type:'postgres' as const,transaction:true},
    trustedOrigins: [config.origin],
    emailAndPassword: { enabled: true, disableSignUp: !config.smtp, minPasswordLength: 12, maxPasswordLength: 128,
      requireEmailVerification: true,autoSignIn:false,revokeSessionsOnPasswordReset:true,resetPasswordTokenExpiresIn:1800,
      sendResetPassword: async({user,url}:{user:{email:string};url:string})=>enqueue('reset',user.email,url) },
    emailVerification:{sendOnSignUp:true,sendOnSignIn:false,autoSignInAfterVerification:false,expiresIn:1800,
      sendVerificationEmail:async({user,url}:{user:{email:string};url:string})=>enqueue('verify',user.email,url)},
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: 'database' as const, window: 60, max: 60 },
    advanced: { useSecureCookies: config.origin.startsWith('https:'),
      // Set by our ingress from the socket, overwriting any caller-supplied value.
      ipAddress: { ipAddressHeaders: ['x-desvio-peer-ip'] },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' as const },
      database: { generateId: 'uuid' as const } },
    logger: { disabled: true },
    // The underlying router otherwise prints unexpected database errors despite disabled
    // auth logging. Propagate them to our sanitized HTTP boundary instead.
    onAPIError: {throw:true},
  };
}

export function createAuth(pool: Pool, config: Config,mail:MailQueue) { return betterAuth(authOptions(pool, config,mail)); }
export type Auth = ReturnType<typeof createAuth>;
