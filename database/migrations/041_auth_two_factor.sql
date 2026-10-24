-- Better Auth 1.7.12 twoFactor plugin schema; auth-only, never tenant runtime access.
ALTER TABLE auth."user" ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;
CREATE TABLE auth."twoFactor" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 secret text NOT NULL,
 "backupCodes" text NOT NULL,
 "userId" uuid NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 verified boolean DEFAULT true,
 "failedVerificationCount" integer DEFAULT 0,
 "lockedUntil" timestamptz
);
CREATE INDEX "twoFactor_secret_idx" ON auth."twoFactor"(secret);
CREATE INDEX "twoFactor_userId_idx" ON auth."twoFactor"("userId");
REVOKE ALL ON auth."twoFactor" FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth."twoFactor" TO desvio_auth;
