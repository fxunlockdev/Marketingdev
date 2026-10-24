"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {MfaChallenge} from './mfa';
import { api } from "./api";
import { Field, Notice, Wordmark } from "./primitives";
export function AuthScreen({ mode }: { mode: string }) {
  const router = useRouter(),
    [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [sent, setSent] = useState(false),
    [token, setToken] = useState(""),
    [invite, setInvite] = useState(""),
    [challenge,setChallenge]=useState(false);
  const signup = mode === "sign-up",
    forgot = mode === "forgot-password",
    reset = mode === "reset-password",
    verify = mode === "verify-email";
  useEffect(() => {
    const url = new URL(location.href);
    setInvite(new URLSearchParams(url.hash.slice(1)).get("invite") ?? "");
    if (reset) {
      setToken(url.searchParams.get("token") ?? "");
      history.replaceState(null, "", url.pathname);
      if (url.searchParams.has("error"))
        setError(new Error("This reset link has expired. Request a new one."));
    }
  }, [reset]);
  function finishSignIn(){
        if (invite)
          location.assign(
            "/accept-invitation#token=" + encodeURIComponent(invite),
          );
        else {
          router.replace("/");
          router.refresh();
        }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (signup) {
        await api("/api/auth/sign-up/email", {
          name,
          email,
          password,
          callbackURL:
            location.origin +
            "/sign-in" +
            (invite ? "#invite=" + encodeURIComponent(invite) : ""),
        });
        setSent(true);
        setPassword("");
      } else if (forgot) {
        await api("/api/auth/request-password-reset", {
          email,
          redirectTo: location.origin + "/reset-password",
        });
        setSent(true);
      } else if (verify) {
        await api("/api/auth/send-verification-email", {
          email,
          callbackURL:
            location.origin +
            "/sign-in" +
            (invite ? "#invite=" + encodeURIComponent(invite) : ""),
        });
        setSent(true);
      } else if (reset) {
        await api("/api/auth/reset-password", { token, newPassword: password });
        setPassword("");
        setSent(true);
      } else {
        const result=await api("/api/auth/sign-in/email", { email, password });
        setPassword("");
        if(result.twoFactorRedirect){setChallenge(true);return;}
        finishSignIn();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const title = challenge ? "Verify it’s you." : signup
    ? "A clear home for every brand."
    : forgot
      ? "Let’s get you back in."
      : reset
        ? "Choose a new password."
        : verify
          ? "Verify your email."
          : "Welcome back.";
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Wordmark />
        <div>
          <span className="eyebrow">YOUR BRANDS. YOUR DIRECTION.</span>
          <h2>
            Good creative starts
            <br />
            with knowing
            <br />
            <em>your brand.</em>
          </h2>
          <p>
            Keep each client’s identity, references and team together in one
            considered workspace.
          </p>
        </div>
        <span className="story-foot">
          A little more clarity. A lot more you.
        </span>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-card">
          <div className="mobile-wordmark">
            <Wordmark />
          </div>
          <span className="eyebrow">DESVIO WORKSPACE</span>
          <h1>{title}</h1>
          <p className="intro">
            {signup
              ? "Start with your account. Add your clients and brands next."
              : forgot
                ? "We’ll email a secure link if there’s an account with that address."
                : reset
                  ? "Use at least 12 characters. Your other sessions will be signed out."
                  : verify
                    ? "Enter your address to request a fresh verification link."
                    : "Sign in to pick up where you left off."}
          </p>
          {sent ? (
            <section className="confirmation" role="status">
              <h2>{reset ? "Password updated" : "Check your inbox"}</h2>
              <p>
                {reset
                  ? "Your new password is ready. Sign in to continue."
                  : forgot
                    ? "If an account exists, a reset email is queued. Check your inbox and spam folder."
                    : "A verification email has been requested. Open its link before signing in."}
              </p>
              <a
                className="button primary"
                href={
                  "/sign-in" +
                  (invite ? "#invite=" + encodeURIComponent(invite) : "")
                }
              >
                Back to sign in
              </a>
            </section>
          ) : challenge ? <MfaChallenge onVerified={finishSignIn} onCancel={()=>{setChallenge(false);setError(undefined);}}/> : (
            <form onSubmit={submit} aria-busy={busy}>
              {signup && (
                <Field label="Your name">
                  {(id) => (
                    <input
                      id={id}
                      required
                      maxLength={100}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  )}
                </Field>
              )}
              {!reset && (
                <Field label="Email address">
                  {(id) => (
                    <input
                      id={id}
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  )}
                </Field>
              )}
              {!forgot && !verify && (
                <Field
                  label="Password"
                  hint={signup || reset ? "At least 12 characters." : ""}
                >
                  {(id, hint) => (
                    <input
                      id={id}
                      type="password"
                      required
                      minLength={signup || reset ? 12 : 1}
                      maxLength={128}
                      autoComplete={
                        signup || reset ? "new-password" : "current-password"
                      }
                      aria-describedby={hint}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  )}
                </Field>
              )}
              <Notice error={error} />
              <button
                className="primary full"
                disabled={busy || (reset && !token)}
              >
                {busy
                  ? "Please wait…"
                  : signup
                    ? "Create account"
                    : forgot
                      ? "Send reset link"
                      : verify
                        ? "Send verification link"
                        : reset
                          ? "Save new password"
                          : "Sign in"}
                <span aria-hidden="true">↗</span>
              </button>
              {reset && !token && (
                <p className="hint">
                  Open the link from your reset email to continue.{" "}
                  <a href="/forgot-password">Request a new link</a>.
                </p>
              )}
            </form>
          )}
          <div className="auth-links">
            {!signup && !forgot && !reset && !verify ? (
              <>
                <a href="/forgot-password">Forgot password?</a>
                <a href="/verify-email">Resend verification</a>
                <p>
                  New to Desvio?{" "}
                  <a
                    href={
                      "/sign-up" +
                      (invite ? "#invite=" + encodeURIComponent(invite) : "")
                    }
                  >
                    Create an account
                  </a>
                </p>
              </>
            ) : (
              <p>
                Already have an account?{" "}
                <a
                  href={
                    "/sign-in" +
                    (invite ? "#invite=" + encodeURIComponent(invite) : "")
                  }
                >
                  Sign in
                </a>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
