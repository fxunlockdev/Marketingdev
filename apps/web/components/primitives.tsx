"use client";
import {Spinner} from "@astryxdesign/core/Spinner";
import {AppLink} from "./app-link";
import { useId, type ReactNode } from "react";
import { ApiError, message } from "./api";
export function Notice({ error }: { error: unknown }) {
  return error ? (
    <div className="notice error" role="alert">
      {message(error)}
      {error instanceof ApiError && error.reauthenticate && (
        <>
          {" "}
          <a href="/sign-in" target="_blank" rel="noopener">
            Sign in in a new tab
          </a>
          , then retry here.
        </>
      )}
    </div>
  ) : null;
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string, hintId?: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, hint ? `${id}-hint` : undefined)}
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
/** `tone="paper"` is the ivory wordmark for ink surfaces; the default is for paper and white. */
export function Wordmark({ tone = "ink" }: { tone?: "ink" | "paper" }) {
  return (
    <AppLink href="/" className="wordmark" aria-label="Desvio home">
      <img src={`/site-brand/brand/desvio-${tone === "paper" ? "ivory" : "black"}-lime.svg`} alt="Desvio" width="146" height="36" />
    </AppLink>
  );
}
export function Loading() {
  return (
    <div role="status" className="loading ds-loading">
      <Spinner size="md" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}
/** Full-viewport neutral state shown while the session is unknown: no navigation, no account chrome. */
export function SessionPending() {
  return (
    <main id="main" className="session-pending" aria-busy="true">
      <img src="/site-brand/brand/desvio-black-lime.svg" alt="Desvio" width="146" height="36" />
      <div role="status" className="session-pending-status">
        <Spinner size="md" aria-hidden="true" />
        <span>Opening Desvio…</span>
      </div>
    </main>
  );
}
export function Blank({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="blank">
      <span className="empty-mark" aria-hidden="true">
        +
      </span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
