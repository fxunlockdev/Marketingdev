"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Asset, type Workspace, ApiError } from "./api";
import { useUnsavedChanges } from "./unsaved";
import { Field, Loading, Notice } from "./primitives";
const states: Record<string, string> = {
  awaiting_upload: "Waiting for file",
  queued: "Queued for checks",
  validating: "Checking file",
  ready: "Ready to download",
  rejected: "File rejected",
  failed: "Checks failed",
  canceled: "Canceled",
};
const reasons: Record<string, string> = {
  MALWARE_DETECTED: "The safety scan rejected this file. Choose a clean copy.",
  CHECKSUM_MISMATCH: "The uploaded file changed. Select and upload it again.",
  SIZE_MISMATCH: "The upload was incomplete. Upload the original file again.",
  INVALID_IMAGE:
    "This image could not be read. Export a new PNG, JPEG or WebP.",
  INVALID_PDF: "This PDF could not be read. Export a new copy.",
  INVALID_PRESENTATION:
    "This presentation could not be read. Export a new PPTX.",
  UNSAFE_PRESENTATION:
    "This presentation contains unsupported content. Export a simpler PPTX.",
  VALIDATION_RETRIES_EXHAUSTED:
    "File checks could not finish. Your record is saved. You can upload the file again.",
  ACCESS_REVOKED_OR_CANCELED:
    "Checks were canceled or the requester’s access changed.",
};
const types: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export function BrandFiles({
  org,
  brandId,
}: {
  org: Workspace;
  brandId: string;
}) {
  const path = `/api/v1/workspaces/${org.id}/brands/${brandId}`,
    [assets, setAssets] = useState<Asset[]>(),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState<unknown>(),
    [loadError, setLoadError] = useState<unknown>();
  const requestKey = useRef<string | null>(null),
    reservation = useRef<string | null>(null),
    input = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  useUnsavedChanges(busy);
  async function load() {
    try {
      const value = await api(path + "/assets");
      if (alive.current) {
        setAssets(value.assets);
        setLoadError(undefined);
      }
    } catch (e) {
      if (alive.current) setLoadError(e);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [path]);
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const type = types[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
      if (!type || file.size < 1 || file.size > 20 * 1024 * 1024)
        throw new Error("Choose a PNG, JPEG, WebP, PDF or PPTX up to 20 MB.");
      setProgress("Preparing your file…");
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      requestKey.current ??= crypto.randomUUID();
      if (!reservation.current) {
        const reserved = await api(
          path + "/uploads",
          {
            filename: file.name,
            contentType: type,
            bytes: file.size,
            sha256: hash,
          },
          "POST",
          requestKey.current,
        );
        reservation.current = reserved.id;
        setProgress("Uploading your file…");
        try {
          const response = await fetch(reserved.upload.url, {
            method: "PUT",
            headers: { "content-type": type },
            body: file,
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: AbortSignal.timeout(120000),
          });
          if (!response.ok) throw new Error();
        } catch {
          try {
            await api(`${path}/assets/${reserved.id}/abandon`, {});
          } catch {}
          reservation.current = null;
          requestKey.current = null;
          throw new Error(
            "The upload could not finish. Your selected file is still here. Retry, or dismiss the waiting upload below.",
          );
        }
      }
      setProgress("Starting file checks…");
      await api(`${path}/assets/${reservation.current}/complete`, {});
      reservation.current = null;
      requestKey.current = null;
      setFile(undefined);
      if (input.current) input.current.value = "";
      setProgress("Uploaded. Safety and format checks are running.");
      await load();
    } catch (e) {
      setError(e);
      setProgress("");
    } finally {
      setBusy(false);
    }
  }
  async function action(asset: Asset, action: string) {
    setError(undefined);
    try {
      if (action === "download") {
        const result = await api(`${path}/assets/${asset.id}/download`, {});
        const url = new URL(result.url);
        if (!["http:", "https:"].includes(url.protocol))
          throw new Error("Download unavailable");
        location.assign(url.toString());
      } else {
        await api(
          action === "abandon"
            ? `${path}/assets/${asset.id}/abandon`
            : `${path}/jobs/${asset.job_id}/cancel`,
          {},
        );
        await load();
      }
    } catch (e) {
      setError(e);
    }
  }
  return (
    <section className="file-library">
      <div className="section-heading">
        <div>
          <h2>Brand files</h2>
          <p className="hint">Guidelines, logos and visual references.</p>
        </div>
        <span className="status neutral">Private to this client</span>
      </div>
      {["owner","admin","editor"].includes(org.role) && (
        <form className="upload-panel" onSubmit={upload} aria-busy={busy}>
          <span className="upload-icon" aria-hidden="true">
            ↥
          </span>
          <Field
            label="Choose a brand file"
            hint="PNG, JPEG, WebP, PDF or PPTX · up to 20 MB"
          >
            {(id, hint) => (
              <input
                ref={input}
                id={id}
                type="file"
                required
                accept=".png,.jpg,.jpeg,.webp,.pdf,.pptx"
                disabled={busy}
                aria-describedby={hint}
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  requestKey.current = null;
                  reservation.current = null;
                  setError(undefined);
                  setProgress("");
                }}
              />
            )}
          </Field>
          <button className="primary" disabled={busy || !file}>
            {busy
              ? "Uploading…"
              : reservation.current
                ? "Retry file submission"
                : "Upload file"}
          </button>
          <p className="hint">
            Files stay unavailable until safety and format checks pass.
          </p>
          {progress && <p role="status">{progress}</p>}
        </form>
      )}
      <Notice error={error} />
      <Notice error={loadError} />
      {!!loadError && (
        <button onClick={() => void load()}>Refresh files</button>
      )}
      {!assets ? (
        <Loading />
      ) : assets.length ? (
        <ul className="file-list" aria-label="Brand files">
          {assets.map((asset) => (
            <li key={asset.id} className="file-row">
              <span className="file-type" aria-hidden="true">
                {asset.content_type === "application/pdf"
                  ? "PDF"
                  : asset.content_type.startsWith("image/")
                    ? "IMG"
                    : "PPT"}
              </span>
              <div className="file-info">
                <strong>{asset.filename}</strong>
                <span>
                  {Math.ceil(asset.expected_bytes / 1024)} KB ·{" "}
                  {asset.cancel_requested &&
                  ["queued", "validating"].includes(asset.state)
                    ? "Cancel requested"
                    : (states[asset.state] ?? "Status unavailable")}
                </span>
                {asset.error_code && (
                  <p className="file-error">
                    {reasons[asset.error_code] ??
                      "We couldn’t validate this file. Try a new copy."}
                  </p>
                )}
              </div>
              <div className="file-actions">
                {asset.state === "ready" && (
                  <button onClick={() => void action(asset, "download")}>
                    Download
                  </button>
                )}
                {["owner","admin","editor"].includes(org.role) && asset.state === "awaiting_upload" && (
                  <button onClick={() => void action(asset, "abandon")}>
                    Dismiss upload
                  </button>
                )}
                {["owner","admin","editor"].includes(org.role) &&
                  asset.job_id &&
                  ["queued", "validating"].includes(asset.state) && (
                    <button
                      disabled={!!asset.cancel_requested}
                      onClick={() => void action(asset, "cancel")}
                    >
                      Cancel checks
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="file-empty">
          <strong>Your reference library starts here.</strong>
          <p>Upload the files your team uses to understand this brand.</p>
        </div>
      )}
    </section>
  );
}
