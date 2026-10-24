"use client";
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
export function Wordmark() {
  return (
    <a href="/" className="wordmark" aria-label="Desvio home">
      <span className="brand-mark" aria-hidden="true" />
      desvio
      <span className="wordmark-dot" aria-hidden="true">
        .
      </span>
    </a>
  );
}
export function Loading() {
  return (
    <p role="status" className="loading">
      Loading your workspace…
    </p>
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
