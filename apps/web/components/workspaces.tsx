"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type Workspace, type Brand } from "./api";
import { Blank, Field, Loading, Notice } from "./primitives";
import { useUnsavedChanges } from "./unsaved";
import { BrandFiles } from "./uploads";
export function WorkspaceHome({
  org,
  workspaces,
}: {
  org?: Workspace;
  workspaces: Workspace[];
}) {
  const [items, setItems] = useState<Brand[] | Workspace[] | undefined>(
      org ? undefined : workspaces,
    ),
    [error, setError] = useState<unknown>(),
    [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [website, setWebsite] = useState(""),
    [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null),
    lastBody = useRef("");
  useUnsavedChanges(adding && !!(name || website) && !busy);
  async function load() {
    try {
      setItems(
        org
          ? (await api(`/api/v1/workspaces/${org.id}/brands`)).brands
          : (await api("/api/v1/workspaces")).workspaces,
      );
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    if (org) void load();
  }, [org?.id]);
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const body = org ? { name, website: website || null } : { name },
        signature = JSON.stringify(body);
      if (signature !== lastBody.current) {
        key.current = crypto.randomUUID();
        lastBody.current = signature;
      }
      const value = await api(
        org ? `/api/v1/workspaces/${org.id}/brands` : "/api/v1/workspaces",
        body,
        "POST",
        org ? key.current! : undefined,
      );
      location.assign(
        org ? `/clients/${org.id}/brands/${value.id}` : `/clients/${value.id}`,
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const writable = !org || org.role !== "viewer";
  const ambiguousCreate =
    !org && error instanceof ApiError && error.status === 0;
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {org ? "BRAND WORKSPACE" : "YOUR CLIENTS"}
          </span>
          <h1>{org ? org.name : "Every client. A clear space."}</h1>
          <p className="intro">
            {org
              ? "Build a shared home for each brand’s identity and references."
              : "Keep your clients’ brands, files and people separate. Switch context with confidence."}
          </p>
        </div>
        {writable && (
          <button className="primary" onClick={() => setAdding(true)}>
            + {org ? "Add brand" : "Add client"}
          </button>
        )}
      </div>
      <Notice error={error} />
      {ambiguousCreate && (
        <p className="hint">
          Refresh the saved client list before creating another workspace.
        </p>
      )}
      {!!error && (
        <button onClick={() => void load()}>
          Refresh saved {org ? "brands" : "clients"}
        </button>
      )}
      {adding && (
        <section className="editor-panel">
          <div className="section-heading">
            <h2>{org ? "Add a brand" : "Create a client workspace"}</h2>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              Close
            </button>
          </div>
          <form onSubmit={create} aria-busy={busy}>
            <Field label={org ? "Brand name" : "Client name"}>
              {(id) => (
                <input
                  autoFocus
                  id={id}
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            {org && (
              <Field
                label="Website (optional)"
                hint="Save a reference address. Website discovery will be available in a later release."
              >
                {(id, hint) => (
                  <input
                    id={id}
                    type="url"
                    placeholder="https://yourbrand.com"
                    aria-describedby={hint}
                    maxLength={2048}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Notice error={error} />
            <button
              className="primary"
              disabled={
                busy ||
                (!org && error instanceof ApiError && error.status === 0)
              }
            >
              {busy ? "Saving…" : org ? "Create brand" : "Create client"}
            </button>
          </form>
        </section>
      )}
      {!items ? (
        <Loading />
      ) : items.length ? (
        <>
          <div className="section-heading">
            <h2>{org ? "Brands" : "Client workspaces"}</h2>
            <span className="muted">
              {items.length} {items.length === 1 ? "workspace" : "workspaces"}
            </span>
          </div>
          <ul className="workspace-grid">
            {items.map((item, index) => (
              <li key={item.id}>
                <a
                  className="workspace-card"
                  href={
                    org
                      ? `/clients/${org.id}/brands/${item.id}`
                      : `/clients/${item.id}`
                  }
                >
                  <div className="card-top">
                    <span className="identity-tile" data-tone={index % 3}>
                      {item.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </div>
                  <h3>{item.name}</h3>
                  <p>
                    {"role" in item
                      ? `${item.role[0].toUpperCase() + item.role.slice(1)} access`
                      : item.website
                        ? new URL(item.website).hostname
                        : "Brand references & details"}
                  </p>
                  <span className="card-foot">
                    {org ? "Open brand" : "View brands"}{" "}
                    <span aria-hidden="true">→</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        !adding && (
          <Blank
            title={
              org ? "Give your brand a home." : "Start with your first client."
            }
          >
            <p>
              {org
                ? "Add a brand, save its website and bring in the files your team works from."
                : "Each client gets its own brands, files and team access."}
            </p>
            {writable && (
              <button onClick={() => setAdding(true)} className="primary">
                {org ? "Add your first brand" : "Create a client workspace"}
              </button>
            )}
          </Blank>
        )
      )}
      <aside className="context-note">
        <span className="eyebrow">A STRONG FOUNDATION</span>
        <p>
          Start with the details that make the brand yours. Creative generation
          and publishing will appear here when they’re ready.
        </p>
      </aside>
    </div>
  );
}
export function BrandHome({
  org,
  brandId,
}: {
  org: Workspace;
  brandId: string;
}) {
  const [brand, setBrand] = useState<Brand>(),
    [name, setName] = useState(""),
    [website, setWebsite] = useState(""),
    [error, setError] = useState<unknown>(),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [editing, setEditing] = useState(false);
  const path = `/api/v1/workspaces/${org.id}/brands/${brandId}`;
  useUnsavedChanges(
    editing &&
      !!brand &&
      (name !== brand.name || website !== (brand.website ?? "")) &&
      !saving,
  );
  async function load() {
    try {
      const data = await api<Brand>(path);
      setBrand(data);
      setName(data.name);
      setWebsite(data.website ?? "");
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => {
    void load();
  }, [path]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      const value = await api<Brand>(
        path,
        { name, website: website || null, revision: brand?.revision },
        "PATCH",
      );
      setBrand(value);
      setSaved(true);
      setEditing(false);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }
  if (!brand)
    return (
      <div className="page">
        <Notice error={error} />
        {error ? (
          <a href={`/clients/${org.id}`}>Back to client</a>
        ) : (
          <Loading />
        )}
      </div>
    );
  return (
    <div className="page">
      <a className="back-link" href={`/clients/${org.id}`}>
        ← {org.name} / Brands
      </a>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BRAND REFERENCE LIBRARY</span>
          <h1>{brand.name}</h1>
          <p className="intro">
            The details and source files that keep your team on the same page.
          </p>
        </div>
        <span className="status neutral">Brand setup</span>
      </div>
      <div className="brand-layout">
        <section className="brand-details">
          <div className="section-heading">
            <h2>Brand details</h2>
            {org.role !== "viewer" && !editing && (
              <button
                className="quiet"
                onClick={() => {
                  setEditing(true);
                  setSaved(false);
                }}
              >
                Edit details
              </button>
            )}
          </div>
          {editing ? (
            <form onSubmit={save} aria-busy={saving}>
              <Field label="Brand name">
                {(id) => (
                  <input
                    id={id}
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Website (optional)">
                {(id) => (
                  <input
                    id={id}
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                )}
              </Field>
              <Notice error={error} />
              <div className="actions">
                <button className="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save details"}
                </button>
                <button
                  disabled={saving}
                  onClick={() => {
                    setName(brand.name);
                    setWebsite(brand.website ?? "");
                    setEditing(false);
                    setError(undefined);
                  }}
                  type="button"
                >
                  Cancel edit
                </button>
              </div>
              {!!error && (
                <details className="conflict-help">
                  <summary>Review the saved version</summary>
                  <p>
                    Copy any unsaved changes you want to keep, then reload the
                    latest saved details.
                  </p>
                  <button type="button" onClick={() => void load()}>
                    Reload saved details
                  </button>
                </details>
              )}
            </form>
          ) : (
            <>
              <dl>
                <dt>Brand name</dt>
                <dd>{brand.name}</dd>
                <dt>Website</dt>
                <dd>
                  {brand.website ? (
                    <a
                      href={brand.website}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {new URL(brand.website).hostname} ↗
                    </a>
                  ) : (
                    "Not added"
                  )}
                </dd>
              </dl>
              {saved && (
                <p className="success-text" role="status">
                  Brand details saved.
                </p>
              )}
            </>
          )}
          <div className="inline-note">
            <strong>References first</strong>
            <p>
              Files are stored for this brand. Brand discovery, fact review and
              approval are not available yet.
            </p>
          </div>
        </section>
        <BrandFiles org={org} brandId={brandId} />
      </div>
    </div>
  );
}
