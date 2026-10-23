"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Field, Loading, Notice } from "./primitives";
import { CreativeEditor } from "./creative-editor";
import {VideoReview} from './video-canvas';
import {CreativeExportPanel} from './creative-export';
import { useUnsavedChanges } from "./unsaved";
import {
  addDays,
  dayStart,
  localCandidates,
  localMinute,
} from "../../api/src/local-calendar";
type Business = {
  id: string;
  name: string;
  role: string;
  has_approved_brand: boolean;
};
const labels: Record<string, string> = {
  content_needed: "Needs creative",
  draft_ready: "Draft ready",
  pending_review: "Ready for review",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  cancelled: "Canceled",
};
const channels = [
  ["", "All channels"],
  ["linkedin", "LinkedIn"],
  ["instagram", "Instagram"],
];
const running = (j: any) =>
  ["queued", "running", "retrying"].includes(j.status);
const name = (s: string) => channels.find((c) => c[0] === s)?.[1] ?? s;
const when = (s: any) =>
  new Intl.DateTimeFormat("en", {
    timeZone: s.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(s.planned_at));
function jobText(j: any) {
  if (j.cancel_requested && running(j)) return "Cancel requested";
  if (j.status === "unknown")
    return "Result uncertain — review required before retrying";
  if (j.status === "rejected" || j.status === "failed") {
    if (
      j.error_code?.includes("APPROVAL_REQUIRED") ||
      j.error_code?.includes("NOT_CONFIGURED") || j.error_code?.includes("CONFIG_CHANGED")
    )
      return "AI setup is required. Contact your workspace administrator.";
    if (j.error_code?.includes("BUDGET"))
      return "Generation budget reached. Contact your workspace administrator.";
    if (j.error_code?.includes("SLOT_CHANGED"))
      return "The planned post changed before generation started.";
    return "Could not finish this request. Your saved work is safe.";
  }
  return (
    (
      {
        queued: "Queued",
        running: "Creating",
        retrying: "Recovering saved work",
        succeeded: "Ready",
        canceled: "Canceled",
      } as any
    )[j.status] ?? j.status
  );
}
function requestKey(
  ref: { current: { body: string; key: string } | null },
  body: unknown,
) {
  const value = JSON.stringify(body);
  if (ref.current?.body !== value)
    ref.current = { body: value, key: crypto.randomUUID() };
  return ref.current!.key;
}
export function ContentWorkspace({
  business,
  inbox = false,
}: {
  business: Business;
  inbox?: boolean;
}) {
  const root = `/api/v1/businesses/${business.id}`;
  const [prefs, setPrefs] = useState<any>(),
    [anchor, setAnchor] = useState(""),
    [view, setView] = useState("month"),
    [days, setDays] = useState("30"),
    [channel, setChannel] = useState(""),
    [state, setState] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<any>(),
    [jobs, setJobs] = useState<any[]>([]),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [selection, setSelection] = useState<any[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("");
  const [postDirty, setPostDirty] = useState(false),
    trigger = useRef<HTMLElement | null>(null);
  const [generate, setGenerate] = useState(false),
    [start, setStart] = useState(""),
    [planDays,setPlanDays]=useState(30),
    [planningProvider,setPlanningProvider]=useState('openai'),[postCount,setPostCount]=useState(30),[videoCount,setVideoCount]=useState(0),
    [brief, setBrief] = useState(""),
    key = useRef<{ body: string; key: string } | null>(null);
  useEffect(()=>{const requested=new URLSearchParams(location.search).get('slot');if(requested&&/^[a-f0-9-]{36}$/i.test(requested))setSelected(requested);},[business.id]);
  const [exporting,setExporting]=useState(false),exportActive=useRef(true);
  useEffect(()=>{exportActive.current=true;return()=>{exportActive.current=false;};},[]);
  async function exportCalendar(format:'csv'|'ics'){
    if(!prefs||!first||!last||exporting)return;
    setExporting(true);setError(undefined);
    try{
      const query=new URLSearchParams({start:dayStart(first,prefs.timezone),end:dayStart(last,prefs.timezone),format,...(channel?{channel}:{}),...(state?{state}:{})});
      const file=await api(`${root}/content-plan/export?${query}`);
      if(!exportActive.current)return;
      const url=URL.createObjectURL(new Blob([file.content],{type:file.content_type}));
      const link=document.createElement('a');link.href=url;link.download=file.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage(`Exported ${file.count} saved posts. This does not schedule or publish them.`);
    }catch(e){if(exportActive.current)setError(e);}finally{if(exportActive.current)setExporting(false);}
  }
  const canWrite = ['owner','admin','editor'].includes(business.role),
    canReview = ["owner", "admin", "reviewer"].includes(business.role);
  useUnsavedChanges(!!brief || busy);
  useEffect(() => {
    let active = true;
    api(`${root}/onboarding`)
      .then((p) => {
        if (active) {
          setPrefs(p);
          const today = localMinute(Date.now(), p.timezone).slice(0, 10);
          const requested=new URLSearchParams(location.search).get('start');
          setAnchor(requested&&/^\d{4}-\d{2}-\d{2}$/.test(requested)&&Number.isFinite(Date.parse(requested))?requested:today);
          setStart(today);
        }
      })
      .catch((e) => active && setError(e));
    return () => {
      active = false;
    };
  }, [root]);
  const first = anchor
    ? inbox || view !== "month"
      ? anchor
      : anchor.slice(0, 7) + "-01"
    : "";
  const last = first
    ? inbox
      ? addDays(first, Number(days))
      : view === "month"
        ? addDays(first, 32).slice(0, 7) + "-01"
        : addDays(first, view === "week" ? 7 : 30)
    : "";
  useEffect(() => {
    if (!prefs || !first || !last) return;
    let active = true;
    setData(undefined);
    setError(undefined);
    (async () => {
      try {
        const query = new URLSearchParams({
          start: dayStart(first, prefs.timezone),
          end: dayStart(last, prefs.timezone),
          page: String(page),
          ...(channel ? { channel } : {}),
          ...(state ? { state } : {}),
        });
        const [list, queue] = await Promise.all([
          api(`${root}/${inbox ? "review-inbox" : "content-plan"}?${query}`),
          api(`${root}/content-plan/jobs`),
        ]);
        if (active) {
          setData(list);
          setJobs(queue.jobs);
        }
      } catch (e) {
        if (active) setError(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [root, prefs, first, last, page, channel, state, inbox, reload]);
  useEffect(() => {
    if (!jobs.some(running)) return;
    const timer = setInterval(() => setReload((n) => n + 1), 4000);
    return () => clearInterval(timer);
  }, [jobs]);
  function selectPost(id: string) {
    if (
      postDirty &&
      !window.confirm("Discard your unsaved post changes and feedback?")
    )
      return;
    trigger.current = document.activeElement as HTMLElement;
    setPostDirty(false);
    setSelected(id);
  }
  function filter(change: () => void) {
    change();
    setPage(1);
    setSelection([]);
    setConfirmed(false);
  }
  function movePeriod(direction: number) {
    if (!first || !last) return;
    const next =
      direction > 0
        ? last
        : !inbox && view === "month"
          ? addDays(first, -1).slice(0, 7) + "-01"
          : addDays(first, -(inbox ? Number(days) : view === "week" ? 7 : 30));
    if (next < "2000-01-01" || next > "2100-12-01") return;
    filter(() => setAnchor(next));
  }
  async function plan() {
    setBusy(true);
    setError(undefined);
    try {
      const body = { provider:planningProvider,starts_on: start, brief, duration_days:planDays,post_count:postCount,video_count:videoCount };
      await api(
        `${root}/content-plan/generate`,
        body,
        "POST",
        requestKey(key, body),
      );
      key.current = null;
      setBrief("");
      setGenerate(false);
      filter(() => setAnchor(start));
      setReload((n) => n + 1);
      setMessage(
        "Plan request saved. Follow its progress in Plan activity below.",
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function bulk() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`${root}/reviews/${inbox ? "bulk-approve" : "bulk-submit"}`, {
        ...(inbox ? {confirmed} : {}),
        items: selection.map((s) => ({
          id: s.id,
          revision: s.revision,
          creative_version_id: s.creative_version_id,
          creative_sha256: s.creative_sha256,
          video_version_id: s.video_version_id,
          video_sha256: s.video_sha256,
        })),
      });
      setMessage(
        `${selection.length} ${selection.length === 1 ? "post" : "posts"} ${inbox ? "approved" : "sent for review"}. Nothing has been scheduled or published.`,
      );
      setSelection([]);
      setConfirmed(false);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const calendarDays: string[] = [];
  if (first && last) {
    for (let d = first; d < last; d = addDays(d, 1)) calendarDays.push(d);
  }
  return (
    <div className="content-workspace">
      <div className="section-heading">
        <div>
          <h1>{inbox ? "Review Inbox" : "Content Plan"}</h1>
          <p>
            {inbox
              ? "Review each channel’s next month, with every version and decision saved."
              : "A clear plan for " +
                business.name +
                ". Turn each idea into a creative you can review."}
          </p>
        </div>
        {!inbox && canWrite && (
          <button
            className="primary"
            aria-expanded={generate}
            aria-controls="plan-generator"
            onClick={() => setGenerate((v) => !v)}
          >
            Create content plan
          </button>
        )}
      </div>
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
      {generate && (
        <section id="plan-generator" className="v5-panel">
          <h2>Plan the next {planDays} days</h2>
          <p>
            Your approved brand and saved goals guide {postCount} draft posts across your
            selected channels. Nothing publishes automatically.
          </p>
          {!business.has_approved_brand || prefs?.step !== 3 ? (
            <p>
              <a href={`/b/${business.id}/onboarding`}>
                Finish your brand and goals
              </a>{" "}
              before creating a plan.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void plan();
              }}
            >
              <Field label="Plan duration (days)">{id=><input id={id} type="number" min={1} max={90} required value={planDays} onChange={e=>{setPlanDays(Number(e.target.value));setPostCount(Number(e.target.value));}}/>}</Field>
              <Field label="Planning model">{id=><select id={id} value={planningProvider} onChange={e=>setPlanningProvider(e.target.value)}><option value="openai">OpenAI</option><option value="gemini">Gemini</option></select>}</Field>
              <Field label="Videos in this plan">{id=><input id={id} type="number" min={0} max={Math.min(postCount,30)} required value={videoCount} onChange={e=>setVideoCount(Number(e.target.value))}/>}</Field>
              <Field label="Draft post count">{id=><input id={id} type="number" min={1} max={90} required value={postCount} onChange={e=>setPostCount(Number(e.target.value))}/>}</Field>
              <Field label="Plan starts on">
                {(id) => (
                  <input
                    id={id}
                    type="date"
                    min="2000-01-01"
                    max="2100-12-01"
                    required
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Anything to focus on?"
                hint="Optional. Add a campaign, seasonal theme or priority for this plan."
              >
                {(id, hint) => (
                  <textarea
                    id={id}
                    aria-describedby={hint}
                    maxLength={2000}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                  />
                )}
              </Field>
              <p className="hint">
                {prefs?.timezone} · {prefs?.channels.map(name).join(", ")} ·
                Goal: {prefs?.goal}
              </p>
              <button className="primary" disabled={busy}>
                {busy ? "Queuing…" : "Generate draft plan"}
              </button>
            </form>
          )}
        </section>
      )}
      {jobs.length > 0 && !inbox && (
        <details className="v5-panel" open={jobs.some(running)}>
          <summary>Plan activity ({jobs.length})</summary>
          <ul className="plan-job-list">
            {jobs.slice(0, 10).map((j) => (
              <li key={j.id}>
                <span>
                  {j.preferences.starts_on} · {jobText(j)}
                </span>
                {j.output_plan_id && (
                  <button
                    onClick={() =>
                      filter(() => setAnchor(j.preferences.starts_on))
                    }
                  >
                    View dates
                  </button>
                )}
                {canWrite && running(j) && (
                  <button
                    disabled={busy || j.cancel_requested}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`${root}/planning-jobs/${j.id}/cancel`, {});
                        setReload((n) => n + 1);
                      } catch (e) {
                        setError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Cancel plan request
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <nav className="plan-channels" aria-label="Content channels">
        {channels.map(([value, title]) => (
          <button
            key={value}
            aria-pressed={channel === value}
            onClick={() => filter(() => setChannel(value))}
          >
            {title}
          </button>
        ))}
      </nav>
      <section
        className="v5-panel plan-main"
        aria-label={inbox ? "Review queue" : "Content calendar"}
      >
        <div className="plan-toolbar">
          <Field label={inbox ? "Review from" : "Calendar date"}>
            {(id) => (
              <input
                id={id}
                type="date"
                min="2000-01-01"
                max="2100-12-01"
                value={anchor}
                onChange={(e) => filter(() => setAnchor(e.target.value))}
              />
            )}
          </Field>
          {inbox ? (
            <Field label="Date range">
              {(id) => (
                <select
                  id={id}
                  value={days}
                  onChange={(e) => filter(() => setDays(e.target.value))}
                >
                  <option value="1">One day</option>
                  <option value="7">Next 7 days</option>
                  <option value="30">Next 30 days</option>
                </select>
              )}
            </Field>
          ) : (
            <Field label="Calendar view">
              {(id) => (
                <select
                  id={id}
                  value={view}
                  onChange={(e) => filter(() => setView(e.target.value))}
                >
                  <option value="month">Month</option>
                  <option value="week">7 days</option>
                  <option value="list">30-day list</option>
                </select>
              )}
            </Field>
          )}
          <Field label="Post status">
            {(id) => (
              <select
                id={id}
                value={state}
                onChange={(e) => filter(() => setState(e.target.value))}
              >
                <option value="">All statuses</option>
                {Object.entries(labels)
                  .filter(
                    ([k]) =>
                      !inbox ||
                      !["content_needed", "draft_ready", "cancelled"].includes(
                        k,
                      ),
                  )
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <button onClick={() => setReload((n) => n + 1)}>Refresh posts</button>
          {!inbox&&<><button disabled={!data?.total||exporting} onClick={()=>void exportCalendar('csv')}>Export CSV</button><button disabled={!data?.total||exporting} onClick={()=>void exportCalendar('ics')}>Export calendar</button></>}
          {!inbox && canWrite && view !== 'list' && <button onClick={() => filter(() => setView('list'))}>Select drafts for review</button>}
        </div>
        <div className="plan-actions" aria-label="Calendar navigation">
          <button
            disabled={!first || first <= "2000-01-01"}
            onClick={() => movePeriod(-1)}
          >
            Previous period
          </button>
          <button
            disabled={!last || last > "2100-12-01"}
            onClick={() => movePeriod(1)}
          >
            Next period
          </button>
        </div>
        <p className="hint">
          {prefs?.timezone ?? "Loading time zone…"} · Planned dates only.
          Publishing requires a connected social account and a separate action.
        </p>
        {!data && !error ? (
          <Loading />
        ) : (
          data && (
            <>
              <div className="plan-results">
                <p>
                  {data.total} {data.total === 1 ? "post" : "posts"} in this
                  view{data.total > 100 ? ` · Page ${page}` : ""}
                </p>
                <div>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous page
                  </button>
                  <button
                    disabled={!data.has_more}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next page
                  </button>
                </div>
              </div>
              {data.total === 0 ? (
                <div className="plan-empty">
                  <h2>
                    {inbox
                      ? "Nothing waiting here"
                      : "Space for your next ideas"}
                  </h2>
                  <p>
                    {inbox
                      ? "Posts appear here after they are sent for review. Change the dates or channel to see other posts."
                      : "Create a plan from your brand, or choose another date range to find saved posts."}
                  </p>
                  {inbox && (
                    <a href={`/b/${business.id}/content-plan`}>
                      Open Content Plan
                    </a>
                  )}
                </div>
              ) : !inbox && view !== "list" ? (
                <div
                  className="plan-grid"
                  role="list"
                  aria-label="Days in this view"
                >
                  {calendarDays.map((day) => (
                    <section key={day} role="listitem" className="plan-day">
                      <h2>
                        {new Intl.DateTimeFormat("en", {
                          timeZone: "UTC",
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        }).format(new Date(day + "T12:00:00Z"))}
                      </h2>
                      {data.slots
                        .filter(
                          (s: any) =>
                            localMinute(s.planned_at, prefs.timezone).slice(
                              0,
                              10,
                            ) === day,
                        )
                        .map((s: any) => (
                          <button
                            key={s.id}
                            className="plan-card"
                            onClick={() => selectPost(s.id)}
                            aria-label={`Open ${name(s.channel)} post: ${s.hook || s.brief}`}
                          >
                            <span>
                              {name(s.channel)} ·{" "}
                              {localMinute(s.planned_at, prefs.timezone).slice(
                                11,
                              )}
                            </span>
                            <span>{s.format === 'video' ? 'Video' : 'Static post'}</span>
                            <strong>{s.hook || s.brief}</strong>
                            <span className={`plan-state state-${s.state}`}>
                              {labels[s.state]}
                            </span>
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
              ) : (
                <ul className="plan-post-list">
                  {data.slots.map((s: any) => (
                    <li key={s.id}>
                      {(inbox ? canReview && s.state === "pending_review" : canWrite && ['draft_ready','changes_requested'].includes(s.state)) &&
                        !s.has_newer_version && (
                          <label className="plan-select">
                            <input
                              type="checkbox"
                              checked={selection.some((x) => x.id === s.id)}
                              disabled={busy || (selection.length >= 30 && !selection.some((x) => x.id === s.id))}
                              onChange={(e) => {
                                setSelection((old) =>
                                  e.target.checked
                                    ? [...old, s]
                                    : old.filter((x) => x.id !== s.id),
                                );
                                setConfirmed(false);
                              }}
                            />
                            Select {name(s.channel)} post: {s.hook || s.brief}
                          </label>
                        )}
                      <button
                        className="plan-list-card"
                        onClick={() => selectPost(s.id)}
                      >
                        <span>
                          {name(s.channel)} · {when(s)} ({s.timezone})
                        </span>
                        <span>{s.format === 'video' ? 'Video' : 'Static post'}</span>
                            <strong>{s.hook || s.brief}</strong>
                        <span>{s.caption || s.brief}</span>
                        <span className={`plan-state state-${s.state}`}>
                          {labels[s.state]}
                          {s.has_newer_version
                            ? " · Newer Canvas version available"
                            : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        )}
      </section>
      {selection.length > 0 && (
        <section className="v5-panel">
          <h2>{inbox ? "Approve" : "Send for review:"} {selection.length} selected posts</h2>
          <p>
            Select up to 30 posts. {inbox ? "Approval applies to the selected saved versions." : "Send these saved drafts to your Review Inbox. This does not approve or publish them."} Any changed post will stop the entire batch.
          </p>
          {inbox && <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have reviewed these {selection.length} posts and approve their
            saved versions.
          </label>}
          <div className="plan-actions">
            <button
              className="primary"
              disabled={(inbox && !confirmed) || busy || selection.length > 30}
              onClick={() => void bulk()}
            >
              {inbox ? "Confirm bulk approval" : "Send selected drafts for review"}
            </button>
            <button
              onClick={() => {
                setSelection([]);
                setConfirmed(false);
              }}
            >
              Clear selection
            </button>
          </div>
          {selection.length > 30 && <p>Select at most 30 posts at a time.</p>}
        </section>
      )}
      {selected && (
        <SlotPanel
          key={selected}
          business={business}
          slotId={selected}
          onChanged={() => setReload((n) => n + 1)}
          onDirty={setPostDirty}
          onClose={() => {
            setSelected(null);
            setPostDirty(false);
            queueMicrotask(() => trigger.current?.focus());
          }}
        />
      )}
    </div>
  );
}
function SlotPanel({
  business,
  slotId,
  onChanged,
  onClose,
  onDirty,
}: {
  business: Business;
  slotId: string;
  onChanged: () => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const root = `/api/v1/businesses/${business.id}`,
    [data, setData] = useState<any>(),
    [draft, setDraft] = useState<any>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState(""),
    [reset, setReset] = useState(false),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false),
    [chosen, setChosen] = useState("");
  const dirtyRef = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    key = useRef<{ body: string; key: string } | null>(null),
    alive = useRef(true);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const load = useCallback(
    async (replace = false) => {
      try {
        const d = await api(`${root}/content-slots/${slotId}`);
        if (!alive.current) return;
        setData(d);
        if (replace || !dirtyRef.current) {
          setDraft({
            revision: d.slot.revision,
            brief: d.slot.brief,
            pillar: d.slot.pillar,
            hook: d.slot.hook,
            cta: d.slot.cta,
            video_draft: d.slot.video_draft,
            local: localMinute(d.slot.planned_at, d.slot.timezone),
          });
          setChosen(d.slot.planned_at);
        }
      } catch (e) {
        if (alive.current) setError(e);
      }
    },
    [root, slotId],
  );
  useEffect(() => {
    alive.current = true;
    void load(true);
    heading.current?.focus();
    return () => {
      alive.current = false;
    };
  }, [load]);
  const s = data?.slot,
    active = data?.generations.some(running)||data?.videos?.some(running),
    held = data?.generations.some((j: any) => j.status === "unknown"),
    dirty =
      !!s &&
      !!draft &&
      (draft.brief !== s.brief ||
        draft.pillar !== s.pillar ||
        draft.hook !== s.hook ||
        draft.cta !== s.cta ||
        JSON.stringify(draft.video_draft)!==JSON.stringify(s.video_draft) ||
        draft.local !== localMinute(s.planned_at, s.timezone));
  useEffect(()=>setReady(false),[s?.creative_version_id,s?.video_version_id]);
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty || !!feedback || busy);
  useEffect(
    () => onDirty(dirty || !!feedback || busy),
    [dirty, feedback, busy, onDirty],
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      await load();
      changed.current();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, load]);
  const canWrite = ['owner','admin','editor'].includes(business.role),
    canReview = ["owner", "admin", "reviewer"].includes(business.role),
    locked = busy || !canWrite;
  async function act(
    action: () => Promise<unknown>,
    text: string,
    clear = true,
  ) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (!alive.current) return;
      if (clear) {
        setFeedback("");
        setReset(false);
      }
      setMessage(text);
      await load(true);
      changed.current();
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function review(decision: string) {
    void act(
      () =>
        api(`${root}/reviews/${slotId}`, {
          revision: s.revision,
          creative_version_id: s.creative_version_id,
          creative_sha256: s.creative_sha256,
          video_version_id: s.video_version_id,
          video_sha256: s.video_sha256,
          decision,
          feedback,
        }),
      decision === "approved"
        ? "Approved this saved version. It has not been published."
        : "Review decision saved.",
    );
  }
  const candidates = draft && s ? localCandidates(draft.local, s.timezone) : [];
  const instant =
    candidates.length === 1
      ? candidates[0]
      : candidates.includes(chosen)
        ? chosen
        : "";
  const leave = () => {
    if (
      (dirty || feedback) &&
      !window.confirm("Discard your unsaved changes and feedback?")
    )
      return;
    onClose();
  };
  return (
    <section className="v5-panel slot-panel" aria-label="Post details">
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          Post details
        </h2>
        <button onClick={leave}>Close post</button>
      </div>
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
      {!s || !draft ? (
        <Loading />
      ) : (
        <>
          <div className="slot-heading">
            <span>
              {name(s.channel)} · {when(s)} ({s.timezone})
            </span>
            <span className={`plan-state state-${s.state}`}>
              {labels[s.state]}
            </span>
          </div>
          <p>
            {s.plan_title} · {s.objective}
          </p>
          <div className="slot-columns">
            <div>
              {s.video_version_id ? <><VideoReview key={s.video_version_id} business={business} id={s.video_version_id} previewOnly onReady={setReady}/><a href={`/b/${business.id}/canvas?thread=${s.thread_id}`}>Give video feedback in Canvas</a></> : s.design ? (
                <>
                  <CreativeEditor
                    businessId={business.id}
                    design={s.design}
                    onChange={() => {}}
                    readOnly
                    previewOnly
                    onExportReady={(fn) => setReady(!!fn)}
                  />
                  <h3>Saved caption</h3>
                  <p className="slot-caption">{s.caption}</p>
                  <details>
                    <summary>Creative text and review notes</summary>
                    {s.design.layers.map((l: any) => (
                      <p key={l.id}>{l.text}</p>
                    ))}
                    {s.skill_manifest?.warnings?.map((w: string, i: number) => (
                      <p key={i}>{w}</p>
                    ))}
                  </details>
                  <a href={`/b/${business.id}/canvas?thread=${s.thread_id}`}>
                    Edit in Canvas
                  </a>
                </>
              ) : (
                <div className="plan-empty">
                  <h3>This idea needs a creative</h3>
                  {s.format==='video'&&!dirty&&<a href={`/b/${business.id}/canvas?slot=${s.id}`}>Create this video in Canvas</a>}
                  <p>
                    {s.format==='video'?'Review your script below, then choose an approved reference image in Canvas.':'Create an image from the saved brief, then review it here.'}
                  </p>
                </div>
              )}
              {data?.videos?.map((run:any)=><div key={run.job_id}><p role="status">Video: {run.status.replaceAll('_',' ')}</p><a href={`/b/${business.id}/canvas?thread=${run.thread_id}`}>Open video prompt and review</a>{run.output_version_id&&run.output_version_id!==s.video_version_id&&<button disabled={locked||dirty||(s.state==='approved'&&!reset)} onClick={()=>void act(()=>api(`${root}/content-slots/${slotId}`,{revision:s.revision,video_version_id:run.output_version_id,reset_approval:reset},'PATCH'),'Saved video attached as an unapproved draft.')}>Attach this saved video</button>}</div>)}
              {s.has_newer_version && (
                <div className="notice">
                  <p>
                    A newer Canvas version is available. This post still uses
                    its previous saved version.
                  </p>
                  <button
                    disabled={
                      locked || dirty || (s.state === "approved" && !reset)
                    }
                    onClick={() =>
                      void act(
                        () =>
                          api(
                            `${root}/content-slots/${slotId}`,
                            {
                              revision: s.revision,
                              [s.format==='video'?'video_version_id':'creative_version_id']: s.latest_version_id,
                              reset_approval: reset,
                            },
                            "PATCH",
                          ),
                        "Latest Canvas version attached as an unapproved draft.",
                      )
                    }
                  >
                    Attach latest Canvas version
                  </button>
                </div>
              )}
            </div>
            <div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    () =>
                      api(
                        `${root}/content-slots/${slotId}`,
                        {
                          revision: draft.revision,
                          brief: draft.brief,
                          pillar: draft.pillar,
                          hook: draft.hook,
                          cta: draft.cta,
                          ...(s.format==='video'&&draft.video_draft?{video_draft:draft.video_draft}:{}),
                          planned_at: instant,
                          reset_approval: reset,
                        },
                        "PATCH",
                      ),
                    "Post changes saved.",
                  );
                }}
              >
                <fieldset disabled={locked || s.state === "cancelled"}>
                  {s.format==='video'&&draft.video_draft&&<section aria-label="Planned video script"><h3>Video concept</h3><p>Saving edits does not authorize paid generation.</p>{(['storyline','script','prompt'] as const).map(field=><Field key={field} label={`Planned video ${field}`}>{id=><textarea id={id} maxLength={field==='storyline'?600:1200} value={draft.video_draft[field]} onChange={e=>setDraft({...draft,video_draft:{...draft.video_draft,[field]:e.target.value}})}/>}</Field>)}<Field label="Planned video duration (seconds)">{id=><input id={id} type="number" min={3} max={15} value={draft.video_draft.duration_seconds} onChange={e=>setDraft({...draft,video_draft:{...draft.video_draft,duration_seconds:Number(e.target.value)}})}/>}</Field></section>}
                  <legend>Post brief & planned date</legend>
                  <Field label="Creative brief">
                    {(id) => (
                      <textarea
                        id={id}
                        required
                        maxLength={4000}
                        value={draft.brief}
                        onChange={(e) =>
                          setDraft({ ...draft, brief: e.target.value })
                        }
                      />
                    )}
                  </Field>
                  {[
                    ["pillar", "Content pillar"],
                    ["hook", "Opening hook"],
                    ["cta", "Call to action"],
                  ].map(([k, label]) => (
                    <Field key={k} label={label}>
                      {(id) => (
                        <input
                          id={id}
                          maxLength={k === "pillar" ? 140 : 500}
                          value={draft[k]}
                          onChange={(e) =>
                            setDraft({ ...draft, [k]: e.target.value })
                          }
                        />
                      )}
                    </Field>
                  ))}
                  <Field
                    label={`Planned date & time (${s.timezone})`}
                    hint="This changes the plan only; it does not schedule a social post."
                  >
                    {(id, hint) => (
                      <input
                        id={id}
                        type="datetime-local"
                        required
                        aria-describedby={hint}
                        aria-invalid={!instant}
                        value={draft.local}
                        onChange={(e) => {
                          setDraft({ ...draft, local: e.target.value });
                          setChosen("");
                        }}
                      />
                    )}
                  </Field>
                  {candidates.length === 0 && (
                    <p role="alert">
                      Choose a valid local time. This time may be skipped by
                      daylight saving.
                    </p>
                  )}
                  {candidates.length > 1 && (
                    <Field label="This time occurs twice — choose an offset">
                      {(id) => (
                        <select
                          id={id}
                          required
                          value={instant}
                          onChange={(e) => setChosen(e.target.value)}
                        >
                          <option value="">Choose which occurrence</option>
                          {candidates.map((t) => (
                            <option key={t} value={t}>
                              {new Intl.DateTimeFormat("en", {
                                timeZone: s.timezone,
                                timeStyle: "long",
                              }).format(new Date(t))}{" "}
                              · {t}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  )}
                  {s.state === "approved" && (
                    <label className="plan-select">
                      <input
                        type="checkbox"
                        checked={reset}
                        onChange={(e) => setReset(e.target.checked)}
                      />
                      I understand that changing this post resets approval and
                      requires a new review.
                    </label>
                  )}
                  <button
                    disabled={
                      !dirty || !instant || (s.state === "approved" && !reset)
                    }
                    type="submit"
                  >
                    Save post changes
                  </button>
                </fieldset>
              </form>
              <div className="slot-review">
                <h3>Create & review</h3>
                <Field label="Feedback or creative direction">
                  {(id) => (
                    <textarea
                      id={id}
                      maxLength={2000}
                      value={feedback}
                      disabled={busy || (!canWrite && !canReview)}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                  )}
                </Field>
                {dirty && (
                  <p>Save your post changes before creating or reviewing.</p>
                )}
                {canWrite && s.format !== "video" && s.state !== "cancelled" && (
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      dirty ||
                      active ||
                      held ||
                      (s.state === "approved" && !reset) ||
                      s.has_newer_version
                    }
                    onClick={() => {
                      const body = {
                        revision: s.revision,
                        feedback,
                        reset_approval: reset,
                      };
                      void act(async () => {
                        await api(
                          `${root}/content-slots/${slotId}/generate-creative`,
                          body,
                          "POST",
                          requestKey(key, body),
                        );
                        key.current = null;
                      }, "Creative request queued. The saved result will appear here.");
                    }}
                  >
                    {s.creative_version_id
                      ? "Revise creative"
                      : "Create creative"}
                  </button>
                )}
                <div className="plan-actions">
                  {["draft_ready", "changes_requested"].includes(s.state) &&
                    canWrite && (
                      <button
                        disabled={
                          busy ||
                          dirty ||
                          active ||
                          s.has_newer_version ||
                          !ready
                        }
                        onClick={() => review("pending_review")}
                      >
                        Send for review
                      </button>
                    )}
                  {s.state === "pending_review" && canReview && (
                    <>
                      <button
                        className="primary"
                        disabled={
                          busy || dirty || s.has_newer_version || !ready
                        }
                        onClick={() => review("approved")}
                      >
                        Approve post
                      </button>
                      <button
                        disabled={
                          busy ||
                          dirty ||
                          !feedback.trim() ||
                          s.has_newer_version
                        }
                        onClick={() => review("changes_requested")}
                      >
                        Request changes
                      </button>
                      <button
                        disabled={
                          busy ||
                          dirty ||
                          !feedback.trim() ||
                          s.has_newer_version
                        }
                        onClick={() => review("rejected")}
                      >
                        Reject post
                      </button>
                      <p className="hint">
                        Include feedback to request changes or reject.
                      </p>
                    </>
                  )}
                  {canWrite && s.state !== "cancelled" && (
                    <button
                      disabled={busy || dirty}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Cancel this planned post? Its saved creative and history will be kept.",
                          )
                        )
                          review("cancelled");
                      }}
                    >
                      Cancel planned post
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          {data.generations.length > 0 && (
            <div className="slot-activity">
              <h3>Creative activity</h3>
              <ul className="plan-job-list">
                {data.generations.map((j: any) => (
                  <li key={j.job_id}>
                    <span>
                      {jobText(j)}
                      {j.attachment_status === "needs_attachment"
                        ? " · Plan changed. Review the saved Canvas draft before attaching it."
                        : ""}
                    </span>
                    {j.thread_id && (
                      <a
                        href={`/b/${business.id}/canvas?thread=${j.thread_id}`}
                      >
                        Open saved Canvas
                      </a>
                    )}
                    {j.attachment_status === "needs_attachment" &&
                      j.output_version_id &&
                      canWrite &&
                      s.state !== "cancelled" && (
                        <button
                          disabled={
                            busy || dirty || (s.state === "approved" && !reset)
                          }
                          onClick={() =>
                            void act(
                              () =>
                                api(
                                  `${root}/content-slots/${slotId}`,
                                  {
                                    revision: s.revision,
                                    creative_version_id: j.output_version_id,
                                    reset_approval: reset,
                                  },
                                  "PATCH",
                                ),
                              "Saved draft attached for a new review.",
                            )
                          }
                        >
                          Attach saved draft
                        </button>
                      )}
                    {running(j) && canWrite && (
                      <button
                        disabled={busy || j.cancel_requested}
                        onClick={() =>
                          void act(
                            () =>
                              api(
                                `${root}/creative-jobs/${j.job_id}/cancel`,
                                {},
                              ),
                            "Cancellation requested.",
                            false,
                          )
                        }
                      >
                        Cancel creative request
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.creative_version_id&&<CreativeExportPanel key={business.id+s.id+s.creative_version_id} business={business} versionId={s.creative_version_id} sourceSHA={s.creative_sha256} context={{type:'slot',id:s.id,revision:s.revision,state:s.state}} disabled={dirty||busy||!!feedback} onApproved={async()=>{await load(true);changed.current();}}/>}
          <details className="slot-activity">
            <summary>Version & decision history ({data.events.length})</summary>
            <ol>
              {data.events.map((e: any) => (
                <li key={e.revision}>
                  <strong>
                    Revision {e.revision} ·{" "}
                    {labels[e.action] ?? e.action.replaceAll("_", " ")}
                  </strong>
                  <p>
                    {new Date(e.created_at).toLocaleString()}
                    {e.feedback ? " · " + e.feedback : ""}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}
