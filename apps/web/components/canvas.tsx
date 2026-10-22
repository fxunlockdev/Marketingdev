"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api } from "./api";
import { Field, Loading, Notice } from "./primitives";
import { CreativeEditor, type Design } from "./creative-editor";
import { useUnsavedChanges } from "./unsaved";
type Business = {
  id: string;
  name: string;
  role: string;
  has_approved_brand: boolean;
};
type Thread = { id: string; title: string };
type Run = {
  id: string;
  status: string;
  cancel_requested: boolean;
  error_code: string | null;
  project_id: string;
  output_version_id: string | null;
  channel: string;
  format: string;
  size: string;
};
type Conversation = {
  thread: Thread;
  messages: { id: string; role: string; content: string }[];
  runs: Run[];
  projects: { id: string; title: string; latest_version_id: string | null }[];
};
type Version = {
  id: string;
  parent_id: string | null;
  media_id: string;
  design: Design;
  caption: string;
  status: string;
  review_revision: number;
  created_at: string;
  skill_manifest: any;
};
type Project = {
  project: {
    id: string;
    title: string;
    latest_version_id: string;
    thread_id: string;
  };
  versions: Version[];
  reviews: {
    version_id: string;
    decision: string;
    feedback: string;
    created_at: string;
  }[];
};
const running = (r: Run) =>
  ["queued", "running", "retrying"].includes(r.status);
const label = (s: string) =>
  ({
    queued: "Queued",
    running: "Creating",
    retrying: "Recovering",
    succeeded: "Ready to review",
    unknown: "Needs reconciliation",
    failed: "Could not finish",
    rejected: "Rejected",
    canceled: "Canceled",
    draft: "Draft",
    in_review: "In review",
    approved: "Approved",
    changes_requested: "Changes requested",
  })[s] ?? s;
function problem(code: string | null) {
  if (!code) return "";
  if (/CONFIG|GRANT|RUNTIME|STAGING_APPROVAL/.test(code))
    return "Image generation is not configured for this business yet. Your request has been saved.";
  if (/BUDGET/.test(code))
    return "This request exceeds the configured generation allowance.";
  if (/UNKNOWN|AMBIGUOUS/.test(code))
    return "The provider outcome is uncertain. Further generation is held until it is reconciled to avoid a duplicate charge.";
  if (/VERSION_CHANGED/.test(code))
    return "The creative changed while this request was running. Your newer edits have been preserved.";
  if (/ACCESS/.test(code))
    return "Access changed before this request could finish.";
  return "This request could not finish. Your saved versions are still available.";
}
export function CanvasScreen({ business }: { business: Business }) {
  const root = `/api/v1/businesses/${business.id}`,
    [threads, setThreads] = useState<Thread[]>(),
    [threadId, setThreadId] = useState(""),
    [conversation, setConversation] = useState<Conversation>(),
    [projectId, setProjectId] = useState(""),
    [error, setError] = useState<unknown>(),
    [prompt, setPrompt] = useState(""),
    [channel, setChannel] = useState("instagram"),
    [format, setFormat] = useState("static"),
    [size, setSize] = useState("1024x1024"),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [edit, setEdit] = useState<{ version: Version; run: Run } | null>(null);
  const submitKey = useRef(crypto.randomUUID()),
    threadKey = useRef(crypto.randomUUID()),
    write = business.role !== "viewer";
  useUnsavedChanges(dirty || !!prompt || busy);
  const refreshThreads = useCallback(async () => {
    const list = await api(root + "/canvas/threads");
    setThreads(list.threads);
    return list.threads as Thread[];
  }, [root]);
  useEffect(() => {
    let active = true;
    refreshThreads()
      .then((list) => {
        if (active) {
          const requested = new URLSearchParams(location.search).get("thread");
          setThreadId(
            list.some((t) => t.id === requested)
              ? requested!
              : (list[0]?.id ?? ""),
          );
        }
      })
      .catch((e) => active && setError(e));
    return () => {
      active = false;
    };
  }, [refreshThreads]);
  useEffect(() => {
    if (!threadId) {
      setConversation(undefined);
      return;
    }
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value: Conversation = await api(
          root + `/canvas/threads/${threadId}`,
        );
        if (!active) return;
        setConversation(value);
        setProjectId((p) =>
          value.projects.some((x) => x.id === p)
            ? p
            : (value.projects.find((x) => x.latest_version_id)?.id ?? ""),
        );
        if (value.runs.some((r) => running(r))) timer = setTimeout(load, 2500);
      } catch (e) {
        if (active) setError(e);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [root, threadId, revision]);
  function choose(id: string) {
    if (id === threadId && id) return;
    if (
      (dirty || prompt) &&
      !confirm("Leave your unsaved edits and draft message?")
    )
      return;
    setThreadId(id);
    setConversation(undefined);
    setProjectId("");
    setEdit(null);
    setPrompt("");
    setDirty(false);
    setError(undefined);
    submitKey.current = crypto.randomUUID();
    threadKey.current = crypto.randomUUID();
  }
  const held = conversation?.runs.some(
    (r) => running(r) || r.status === "unknown",
  );
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || dirty) return;
    setBusy(true);
    setError(undefined);
    try {
      let id = threadId;
      if (!id) {
        const t = await api(
          root + "/canvas/threads",
          { title: prompt.trim().slice(0, 140) },
          "POST",
          threadKey.current,
        );
        id = t.id;
        setThreadId(id);
        await refreshThreads();
      }
      await api(
        root + `/canvas/threads/${id}/messages`,
        {
          prompt,
          channel: edit?.run.channel ?? channel,
          format: edit?.run.format ?? format,
          size: edit
            ? `${edit.version.design.width}x${edit.version.design.height}`
            : size,
          parent_version_id: edit?.version.id ?? null,
        },
        "POST",
        submitKey.current,
      );
      submitKey.current = crypto.randomUUID();
      setPrompt("");
      setEdit(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="v5-page-title">
        <span className="eyebrow">{business.name} · CREATIVE STUDIO</span>
        <h1>Canvas</h1>
        <p>
          Describe your idea. Refine the image, edit the words, and approve the
          version you love.
        </p>
      </div>
      {!business.has_approved_brand && (
        <div className="availability-card">
          Confirm your brand profile first so each creative starts from approved
          facts.{" "}
          <a href={`/b/${business.id}/onboarding`}>Continue brand setup</a>
        </div>
      )}
      <Notice error={error} />
      <div className="studio-layout">
        <aside className="studio-conversations" aria-label="Conversations">
          <button disabled={!write || busy} onClick={() => choose("")}>
            + New conversation
          </button>
          {!threads ? (
            <Loading />
          ) : threads.length === 0 ? (
            <p className="hint">Your conversations will appear here.</p>
          ) : (
            <ul>
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    disabled={busy}
                    aria-current={t.id === threadId ? "true" : undefined}
                    onClick={() => choose(t.id)}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="studio-chat" aria-label="Creative conversation">
          <h2>
            {conversation?.thread.title ?? "What would you like to create?"}
          </h2>
          {!conversation?.messages.length && (
            <p className="studio-intro">
              Start with an idea for {business.name}. Describe the occasion, the
              mood, and what you want people to do.
            </p>
          )}
          <ol
            className="studio-messages"
            tabIndex={0}
            aria-label="Conversation messages"
          >
            {conversation?.messages.map((m) => (
              <li key={m.id} className={`studio-message ${m.role}`}>
                <strong>{m.role === "user" ? "You" : "Desvio"}</strong>
                <p>{m.content}</p>
              </li>
            ))}
          </ol>
          {!!conversation?.runs.length && (
            <div className="studio-runs" aria-label="Generation requests">
              {conversation.runs.slice(0, 5).map((r) => (
                <div key={r.id} className="studio-run">
                  <span role={running(r) ? "status" : undefined}>
                    {label(r.status)}
                    {r.cancel_requested && running(r)
                      ? " · cancellation requested"
                      : ""}
                  </span>
                  {r.error_code && r.status !== "canceled" && <p>{problem(r.error_code)}</p>}
                  {running(r) && write && !r.cancel_requested && (
                    <button
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await api(root + `/creative-jobs/${r.id}/cancel`, {});
                          setRevision((n) => n + 1);
                        } catch (e) {
                          setError(e);
                        }
                      }}
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <form className="studio-composer" onSubmit={send}>
            <fieldset
              disabled={!write || busy || held || !business.has_approved_brand}
            >
              <legend>{edit ? "Revise this image" : "Create an image"}</legend>
              {edit && (
                <p>
                  Editing the selected saved version.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setEdit(null);
                      submitKey.current = crypto.randomUUID();
                    }}
                  >
                    Start a new image instead
                  </button>
                </p>
              )}
              <Field
                label={
                  edit ? "Describe your changes" : "Describe your creative"
                }
              >
                {(id) => (
                  <textarea
                    id={id}
                    required
                    maxLength={4000}
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      submitKey.current = crypto.randomUUID();
                    }}
                    placeholder="A welcoming launch post, with a warm photo and a clear invitation…"
                  />
                )}
              </Field>
              {!edit && (
                <div className="studio-options">
                  <Field label="Channel">
                    {(id) => (
                      <select
                        id={id}
                        value={channel}
                        onChange={(e) => {
                          setChannel(e.target.value);
                          submitKey.current = crypto.randomUUID();
                        }}
                      >
                        <option value="instagram">Instagram</option>
                        <option value="linkedin">LinkedIn</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Creative type">
                    {(id) => (
                      <select
                        id={id}
                        value={format}
                        onChange={(e) => {
                          setFormat(e.target.value);
                          submitKey.current = crypto.randomUUID();
                        }}
                      >
                        <option value="static">Social image</option>
                        <option value="ad">Ad creative</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Image shape">
                    {(id) => (
                      <select
                        id={id}
                        value={size}
                        onChange={(e) => {
                          setSize(e.target.value);
                          submitKey.current = crypto.randomUUID();
                        }}
                      >
                        <option value="1024x1024">Square</option>
                        <option value="1024x1536">Portrait</option>
                        <option value="1536x1024">Landscape</option>
                      </select>
                    )}
                  </Field>
                </div>
              )}
              <button
                className="primary"
                disabled={!prompt.trim() || dirty}
                type="submit"
              >
                {busy
                  ? "Saving request…"
                  : edit
                    ? "Generate revision"
                    : "Generate image"}
              </button>
            </fieldset>
            {dirty && (
              <p className="hint">
                Save your creative edits before generating another version.
              </p>
            )}
            {!write && (
              <p className="hint">You have view access to this business.</p>
            )}
            <p className="hint">
              Generation uses your configured allowance. Approval and publishing
              are separate. Video creation is not available yet.
            </p>
          </form>
        </section>
      </div>
      {conversation?.projects.some((p) => p.latest_version_id) && (
        <section className="studio-projects">
          <div className="section-heading">
            <h2>Your creatives</h2>
            <Field label="Creative">
              {(id) => (
                <select
                  id={id}
                  value={projectId}
                  onChange={(e) => {
                    if (dirty && !confirm("Discard unsaved creative edits?"))
                      return;
                    setProjectId(e.target.value);
                    setDirty(false);
                    setEdit(null);
                  }}
                >
                  {conversation.projects
                    .filter((p) => p.latest_version_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          </div>
          {projectId && (
            <CreativeProject
              key={projectId}
              business={business}
              projectId={projectId}
              refresh={
                conversation.projects.find((p) => p.id === projectId)
                  ?.latest_version_id ?? ""
              }
              onDirty={setDirty}
              onRevision={(version) => {
                const run = conversation.runs.find(
                  (r) => r.project_id === projectId,
                );
                if (run) {
                  setEdit({ version, run });
                  submitKey.current = crypto.randomUUID();
                  document
                    .querySelector(".studio-composer textarea")
                    ?.scrollIntoView({ block: "center" });
                  (
                    document.querySelector(
                      ".studio-composer textarea",
                    ) as HTMLTextAreaElement
                  )?.focus();
                }
              }}
            />
          )}
        </section>
      )}
    </>
  );
}
export function CreativeProject({
  business,
  projectId,
  refresh = "",
  onDirty = () => {},
  onRevision,
}: {
  business: Business;
  projectId: string;
  refresh?: string;
  onDirty?: (v: boolean) => void;
  onRevision?: (v: Version) => void;
}) {
  const root = `/api/v1/businesses/${business.id}`,
    [data, setData] = useState<Project>(),
    [selected, setSelected] = useState(""),
    [design, setDesign] = useState<Design>(),
    [caption, setCaption] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(""),
    [notice, setNotice] = useState(""),
    [download, setDownload] = useState<(() => void) | null>(null);
  const dirtyRef = useRef(false),
    version = data?.versions.find((v) => v.id === selected),
    dirty =
      !!version &&
      JSON.stringify({ design, caption }) !==
        JSON.stringify({ design: version.design, caption: version.caption }),
    latest = version?.id === data?.project.latest_version_id,
    write = business.role !== "viewer",
    reviewer = ["owner", "admin"].includes(business.role);
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty || !!feedback || busy);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  useEffect(() => {
    onDirtyRef.current(dirty);
    return () => onDirtyRef.current(false);
  }, [dirty]);
  const load = useCallback(
    async (id?: string) => {
      const value: Project = await api(
        root + `/creative-projects/${projectId}`,
      );
      if (!id && dirtyRef.current) {
        setNotice(
          "Your draft has been kept. Save it or open the latest version before continuing.",
        );
        return;
      }
      setData(value);
      const v = value.versions.find(
        (v) => v.id === (id ?? value.project.latest_version_id),
      )!;
      setSelected(v.id);
      setDesign(structuredClone(v.design));
      setCaption(v.caption);
    },
    [root, projectId],
  );
  useEffect(() => {
    if (dirtyRef.current) {
      setNotice(
        "A new saved version is available. Your unsaved edits have been kept.",
      );
      return;
    }
    void load().catch(setError);
  }, [load, refresh]);
  function choose(id: string) {
    if (dirty && !confirm("Discard unsaved creative edits?")) return;
    const v = data!.versions.find((v) => v.id === id)!;
    setSelected(v.id);
    setDesign(structuredClone(v.design));
    setCaption(v.caption);
    setNotice("");
    setError(undefined);
  }
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const v = await api(root + `/creative-projects/${projectId}/versions`, {
        parent_id: selected,
        design,
        caption,
      });
      await load(v.id);
      setNotice("Saved as a new draft version.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function review(decision: string) {
    setBusy(true);
    setError(undefined);
    try {
      await api(root + `/creative-versions/${selected}/review`, {
        decision,
        feedback,
        revision: version!.review_revision,
      });
      await load(selected);
      setFeedback("");
      setNotice(
        decision === "approved"
          ? "This saved version is approved. It has not been published."
          : "Review saved.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const exportReady = useCallback(
    (fn: (() => void) | null) => setDownload(() => fn),
    [],
  );
  if (!data || !version || !design)
    return (
      <>
        <Notice error={error} />
        {!error && <Loading />}
      </>
    );
  return (
    <article className="creative-project">
      <div className="creative-toolbar">
        <Field label="Saved version">
          {(id) => (
            <select
              id={id}
              disabled={busy}
              value={selected}
              onChange={(e) => choose(e.target.value)}
            >
              {data.versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  Version {data.versions.length - i} · {label(v.status)}
                  {v.id === data.project.latest_version_id ? " · Latest" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <span className="status neutral">
          {dirty ? "Unsaved changes" : label(version.status)}
        </span>
        <button
          disabled={!download || busy || dirty}
          onClick={() => {
            try {
              download?.();
            } catch {
              setError(
                new Error(
                  "The image could not be exported. Reload the image and retry.",
                ),
              );
            }
          }}
        >
          Download PNG
        </button>
      </div>
      <Notice error={error} />
      {notice && <p role="status">{notice}</p>}
      {!latest && (
        <p className="availability-card">
          You’re viewing an earlier version.{" "}
          <button onClick={() => choose(data.project.latest_version_id)}>
            Open latest version
          </button>
        </p>
      )}
      <CreativeEditor
        businessId={business.id}
        design={design}
        onChange={setDesign}
        readOnly={!write || !latest || busy}
        onExportReady={exportReady}
      />
      <Field label="Post caption">
        {(id) => (
          <textarea
            id={id}
            maxLength={3000}
            value={caption}
            disabled={!write || !latest || busy}
            onChange={(e) => setCaption(e.target.value)}
          />
        )}
      </Field>
      <div className="actions">
        {write && latest && (
          <>
            <button
              className="primary"
              disabled={!dirty || busy}
              onClick={save}
            >
              {busy ? "Saving…" : "Save new version"}
            </button>
            {dirty && (
              <button
                disabled={busy}
                onClick={() => {
                  setDesign(structuredClone(version.design));
                  setCaption(version.caption);
                }}
              >
                Discard edits
              </button>
            )}
            {onRevision && (
              <button
                disabled={dirty || busy}
                onClick={() => onRevision(version)}
              >
                Revise image with AI
              </button>
            )}
          </>
        )}
      </div>
      <details className="creative-provenance">
        <summary>Brand context & checks</summary>
        <p>
          This creative used {version.skill_manifest.fact_ids?.length ?? 0}{" "}
          confirmed brand facts. Review generated claims and imagery before
          approving.
        </p>
        {version.skill_manifest.warnings?.length > 0 && (
          <ul>
            {version.skill_manifest.warnings.map((w: string, i: number) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </details>
      <section className="creative-review" aria-label="Creative approval">
        <h3>Review this version</h3>
        <p>
          Edits create a new draft. Approval stays with the exact version
          reviewed.
        </p>
        {write && latest && !dirty && (
          <>
            <Field label="Review feedback">
              {(id) => (
                <textarea
                  id={id}
                  maxLength={2000}
                  disabled={busy}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              )}
            </Field>
            <div className="actions">
              {["draft", "changes_requested"].includes(version.status) && (
                <button disabled={busy} onClick={() => review("in_review")}>
                  Send for review
                </button>
              )}
              {reviewer && version.status === "in_review" && (
                <>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => review("approved")}
                  >
                    Approve version
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => review("changes_requested")}
                  >
                    Request changes
                  </button>
                  <button disabled={busy} onClick={() => review("rejected")}>
                    Reject version
                  </button>
                </>
              )}
            </div>
          </>
        )}
        {data.reviews
          .filter((r) => r.version_id === selected)
          .map((r, i) => (
            <div className="creative-feedback" key={i}>
              <strong>{label(r.decision)}</strong>
              {r.feedback && <p>{r.feedback}</p>}
            </div>
          ))}
      </section>
    </article>
  );
}
