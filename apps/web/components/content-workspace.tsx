"use client";
import {useRouter} from 'next/navigation';
import {postFormatLabel} from './post-format';
import {directedPrompt,type Creativity} from './creative-direction';
import {BrandReferences} from "./brand-references";
import {GeneratedReplacement} from './generated-replacement';
import {StockPicker} from "./stock-picker";
import {PostThumbnail} from "./post-thumbnail";
import {CampaignImages} from "./campaign-images";
import {SavedReferencePreviews} from "./brand-references";
import {CalendarCarouselReview} from './carousels';
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Field, Loading, Notice } from "./primitives";
import { CreativeEditor, type Design } from "./creative-editor";
import "./content-workspace-refinement.css";
import "./calendar-connections-redesign.css";
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
  ["facebook", "Facebook"],
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
function DateStrip({date,onSelect,counts}:{date:string;onSelect:(date:string)=>void;counts:Record<string,number>}) {
 const selected=useRef<HTMLButtonElement>(null);
 useEffect(()=>{selected.current?.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});},[date]);
 const first=date.slice(0,7)+'-01',last=addDays(first,32).slice(0,7)+'-01',days:string[]=[];
 for(let day=first;day<last;day=addDays(day,1))days.push(day);
 return <nav className="plan-date-strip" aria-label="Choose a day">{days.map(day=><button key={day} ref={day===date?selected:undefined} aria-pressed={day===date} aria-label={`${new Intl.DateTimeFormat('en',{timeZone:'UTC',weekday:'short'}).format(new Date(day+'T12:00:00Z'))} ${Number(day.slice(-2))} ${new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'short'}).format(new Date(day+'T12:00:00Z'))}${counts[day]?` ${counts[day]} ${counts[day]===1?'post':'posts'}`:''}, ${day.slice(0,4)}`} onClick={()=>onSelect(day)}><span>{new Intl.DateTimeFormat('en',{timeZone:'UTC',weekday:'short'}).format(new Date(day+'T12:00:00Z'))}</span>{" "}<strong>{Number(day.slice(-2))}</strong>{" "}<span>{new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'short'}).format(new Date(day+'T12:00:00Z'))}</span>{" "}{counts[day]>0&&<span className="date-post-count">{counts[day]} {counts[day]===1?'post':'posts'}</span>}</button>)}</nav>;
}
function DailyPosts({posts,businessId,onOpen,writable,onRefresh}:{posts:any[];businessId:string;onOpen:(id:string)=>void;writable:boolean;onRefresh:()=>void}) {
 const [index,setIndex]=useState(0),current=Math.min(index,posts.length-1),post=posts[current];
 if(!post)return null;
 const hasCreative=Boolean(post.creative_version_id||post.video_version_id||post.carousel_version_id);
 return <section className="daily-post-stage" aria-label="Posts for selected day"><div className="daily-post-pager"><button aria-label="Previous post" disabled={current===0} onClick={()=>setIndex(current-1)}>←</button><p role="status">Post {current+1} of {posts.length}</p><button aria-label="Next post" disabled={current>=posts.length-1} onClick={()=>setIndex(current+1)}>→</button></div>
 <article className={`daily-post ${hasCreative?'':'daily-post-unfinished'}`}><header><strong>{name(post.channel)} · {postFormatLabel(post)}</strong><time dateTime={post.planned_at}>{when(post)}</time></header>
 {hasCreative?<PostThumbnail key={post.id} businessId={businessId} post={post}/>:post.reference_ids?.length?<div className="daily-reference"><SavedReferencePreviews businessId={businessId} ids={post.reference_ids.slice(0,1)}/><span>Reference image · final design not generated yet</span></div>:null}
 <div className="daily-post-copy"><span className={`plan-state state-${post.state}`}>{hasCreative?labels[post.state]:'Topic ready'}</span><h2>{post.hook||post.brief}</h2>{hasCreative&&<p>{post.caption||post.brief}</p>}
 {!hasCreative&&post.format==='static'&&<CampaignImages key={post.id} businessId={businessId} planId={post.plan_id} slots={[post]} disabled={!writable} onRefresh={onRefresh} compact/>}
 <button className={hasCreative?'primary':''} onClick={()=>onOpen(post.id)}>{hasCreative?'Open post':post.format==='video'?'Review script & framing':post.format==='carousel'?'Review carousel topic':'Edit topic & image'}</button></div></article></section>;
}
export function ContentWorkspace({
  business,
  inbox = false,
}: {
  business: Business;
  inbox?: boolean;
}) {
  const router=useRouter();
  const root = `/api/v1/businesses/${business.id}`;
  const [dateCounts,setDateCounts]=useState<Record<string,number>>({});
  const [prefs, setPrefs] = useState<any>(),
    [anchor, setAnchor] = useState(""),
    [view, setView] = useState("week"),
    [days, setDays] = useState("30"),
    [channel, setChannel] = useState(""),
    [campaign,setCampaign] = useState(""),
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
  const [moveDay, setMoveDay] = useState<string>();
  const dragged = useRef<string | null>(null);
  const [postDirty, setPostDirty] = useState(false),
    trigger = useRef<HTMLElement | null>(null),
    calendarHeading = useRef<HTMLHeadingElement>(null);
  const [generate, setGenerate] = useState(false),
    [start, setStart] = useState(""),
    [planDays,setPlanDays]=useState(30),
    [planningCreativity,setPlanningCreativity]=useState<Creativity>('normal'),[postCount,setPostCount]=useState(30),[videoCount,setVideoCount]=useState(0),
    [brief, setBrief] = useState(""),
    key = useRef<{ body: string; key: string } | null>(null);
  useEffect(()=>{const plan=new URLSearchParams(location.search).get('plan');setCampaign(plan&&/^[a-f0-9-]{36}$/i.test(plan)?plan:'');const requested=new URLSearchParams(location.search).get('slot');if(requested&&/^[a-f0-9-]{36}$/i.test(requested))setSelected(requested);},[business.id]);
  const canWrite = ['owner','admin','editor'].includes(business.role),
    canReview = ["owner", "admin", "reviewer"].includes(business.role);
  useUnsavedChanges(!!brief || busy);
  useEffect(() => {
    let active = true;
    api(`${root}/onboarding`)
      .then(async (p) => {
        if (active) {
          const today = localMinute(Date.now(), p.timezone).slice(0, 10);
          const requested=new URLSearchParams(location.search).get('start');
          let initial=requested&&/^\d{4}-\d{2}-\d{2}$/.test(requested)&&Number.isFinite(Date.parse(requested))?requested:today;
          if(!requested&&!inbox){try{const overview=await api(`${root}/overview`);const next=overview.upcoming_posts?.[0];if(next)initial=localMinute(Date.parse(next.planned_at),p.timezone).slice(0,10);}catch{/* Calendar remains usable if overview is unavailable. */}}
          if(!active)return;setAnchor(initial);
          setStart(today);
          setPrefs(p);
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
        : addDays(first, view === "day" ? 1 : view === "week" ? 7 : 30)
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
          ...(campaign ? { plan_id: campaign } : {}),
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
  }, [root, prefs, first, last, page, channel, campaign, state, inbox, reload]);
  const month=anchor.slice(0,7);
  useEffect(()=>{if(!prefs||!month||inbox)return;let active=true;const first=month+'-01';const q=new URLSearchParams({start:dayStart(first,prefs.timezone),end:dayStart(addDays(first,32).slice(0,7)+'-01',prefs.timezone),...(channel?{channel}:{}),...(campaign?{plan_id:campaign}:{}),...(state?{state}:{})});void(async()=>{const counts:Record<string,number>={};let page=1,more=false;do{q.set('page',String(page));const result=await api(root+'/content-plan?'+q);if(!active)return;for(const post of result.slots){const day=localMinute(Date.parse(post.planned_at),prefs.timezone).slice(0,10);counts[day]=(counts[day]??0)+1;}more=result.has_more;page++;}while(more&&page<=100);if(active)setDateCounts(counts);})().catch(()=>{if(active)setDateCounts({});});return()=>{active=false;};},[root,prefs,month,channel,campaign,state,inbox,reload]);
  useEffect(() => {
    if (!jobs.some(running)) return;
    const timer = setInterval(() => {if(!document.hidden)setReload((n) => n + 1);}, 4000);
    return () => clearInterval(timer);
  }, [jobs]);
  function selectPost(id: string, day?: string) {
    if (
      postDirty &&
      !window.confirm("Discard your unsaved post changes and feedback?")
    )
      return;
    if(!inbox&&!day){router.push(`/b/${business.id}/campaign-post?slot=${id}`);return;}
    trigger.current = document.activeElement as HTMLElement;
    setPostDirty(false);
    setMoveDay(day);
    setSelected(id);
    const url=new URL(location.href);url.searchParams.set("slot",id);history.replaceState(history.state,"",url);
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
          : addDays(first, -(inbox ? Number(days) : view === "day" ? 1 : view === "week" ? 7 : 30));
    if (next < "2000-01-01" || next > "2100-12-01") return;
    filter(() => setAnchor(next));
  }
  async function plan() {
    setBusy(true);
    setError(undefined);
    try {
      const body = { provider:"openai",starts_on: start, brief:directedPrompt(brief,planningCreativity), duration_days:planDays,post_count:postCount,video_count:videoCount };
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
          carousel_version_id:s.carousel_version_id,carousel_sha256:s.carousel_sha256,
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
  if(selected)return <div className="content-workspace post-review-workspace">
    <SlotPanel key={`${selected}:${moveDay??"open"}`} moveTo={moveDay&&prefs?{day:moveDay,timezone:prefs.timezone}:undefined}
      business={business} slotId={selected} onChanged={()=>setReload(n=>n+1)} onDirty={setPostDirty}
      onClose={()=>{
        setSelected(null);setPostDirty(false);setMoveDay(undefined);
        const url=new URL(location.href);url.searchParams.delete('slot');history.replaceState(history.state,'',url);
        requestAnimationFrame(()=>calendarHeading.current?.focus());
      }}/>
  </div>;
  return (
    <div className={`content-workspace ${inbox ? "approval-workspace" : "calendar-workspace"}`}>
      {inbox?<div className="section-heading"><div><h1 ref={calendarHeading} tabIndex={-1}>Approvals</h1><p>Review your posts, make adjustments, and approve the versions you love.</p></div></div>:<h1 className="sr-only" ref={calendarHeading} tabIndex={-1}>Calendar</h1>}
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
              <Field label="Plan creativity">{id=><select id={id} value={planningCreativity} onChange={e=>setPlanningCreativity(e.target.value as Creativity)}><option value="normal">Normal</option><option value="creative">Creative</option><option value="super">Super creative</option></select>}</Field>
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
                    maxLength={1600}
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
        <details className="calendar-activity">
          <summary>Plan activity{jobs.some(j=>running(j)&&!j.cancel_requested) ? ` · ${jobs.filter(j=>running(j)&&!j.cancel_requested).length} in progress` : jobs.some(j=>["failed","rejected","unknown"].includes(j.status)) ? " · Needs attention" : ""}</summary>
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
      <section
        className="v5-panel plan-main"
        aria-label={inbox ? "Review queue" : "Content calendar"}
      >
        <div className="plan-toolbar">
          {!inbox&&canWrite&&<button className="primary calendar-create-plan" aria-expanded={generate} aria-controls="plan-generator" onClick={()=>setGenerate(v=>!v)}>Create content plan</button>}
          <div className="calendar-period" role="group" aria-label="Calendar navigation">
            <button aria-label={view==='day'?'Previous day':'Previous period'} disabled={!first || first<='2000-01-01'} onClick={()=>movePeriod(-1)}>‹</button>
            <button disabled={!prefs} onClick={()=>filter(()=>setAnchor(localMinute(Date.now(),prefs.timezone).slice(0,10)))}>Today</button>
            <button aria-label={view==='day'?'Next day':'Next period'} disabled={!last || last>'2100-12-01'} onClick={()=>movePeriod(1)}>›</button>
          </div>
          {campaign&&<button onClick={()=>{filter(()=>setCampaign(''));const url=new URL(location.href);url.searchParams.delete('plan');history.replaceState(history.state,'',url);}}>Show all campaigns</button>}
          <Field label={inbox ? "Review from" : "Calendar date"}>
            {(id) => (
              <input
                id={id}
                type="date"
                min="2000-01-01"
                max="2100-12-01"
                disabled={!prefs}
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
                  <option value="day">Day</option>
                  <option value="month">Month</option>
                  <option value="week">Visual week</option>
                  <option value="list">30-day list</option>
                </select>
              )}
            </Field>
          )}
          <details className="calendar-filters">
            <summary>Filters{channel || state ? ' · Active' : ''}</summary>
            <div className="calendar-filter-fields">
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
            {(channel || state) && <button onClick={()=>filter(()=>{setChannel('');setState('');})}>Clear filters</button>}
            </div>
          </details>
          <button onClick={() => setReload((n) => n + 1)}>Refresh posts</button>
          {!inbox && canWrite && view !== 'list' && <button onClick={() => filter(() => setView('list'))}>Select drafts for review</button>}
        </div>
        {!inbox&&canWrite&&['month','week'].includes(view)&&<p className="calendar-board-hint">Open a post to edit · Drag to reschedule</p>}
        {!inbox && view==='day' && anchor && <DateStrip date={anchor} counts={dateCounts} onSelect={date=>filter(()=>setAnchor(date))} />}
        <p className="hint">
          {prefs?.timezone ?? "Loading time zone…"}
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
                {(page>1||data.has_more)&&<div>
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
                </div>}
              </div>
              {!inbox && view === 'day' && data.total > 0 ? <DailyPosts key={`${anchor}:${channel}:${state}:${page}`} posts={data.slots} businessId={business.id} onOpen={selectPost} writable={["owner","admin","editor"].includes(business.role)} onRefresh={()=>setReload(n=>n+1)} /> : data.total === 0 ? (
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
                  {!inbox&&<a className="button primary" href={`/b/${business.id}/campaigns`}>Open campaigns</a>}
                  {inbox && (
                    <a href={`/b/${business.id}/content-plan`}>
                      Open Content Plan
                    </a>
                  )}
                </div>
              ) : !inbox && view !== "list" ? (
                <div
                  className={`plan-grid ${view==='week'?'plan-grid-week':'plan-grid-month'}`}
                  tabIndex={view==='week'?0:undefined}
                  role="list"
                  aria-label="Days in this view"
                >
                  {calendarDays.map((day) => (
                    <section key={day} role="listitem" className="plan-day" data-calendar-day={day}
                      onDragOver={e=>{if(canWrite&&dragged.current)e.preventDefault();}}
                      onDrop={e=>{e.preventDefault();const id=dragged.current;dragged.current=null;
                        if(canWrite&&id&&data.slots.some((s:any)=>s.id===id&&s.state!=='cancelled'))selectPost(id,day);
                      }}>
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
                            draggable={canWrite&&s.state!=='cancelled'&&!busy}
                            onDragStart={e=>{dragged.current=s.id;trigger.current=e.currentTarget;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',s.id);}}
                            onDragEnd={()=>{dragged.current=null;}}
                            onClick={() => selectPost(s.id)}
                            aria-label={`Open ${name(s.channel)} post: ${s.hook || s.brief}`}
                          >
                            <span className="calendar-card-heading"><span>{postFormatLabel(s)}</span><time dateTime={s.planned_at}>{localMinute(s.planned_at,prefs.timezone).slice(11)}</time></span>
                            <PostThumbnail businessId={business.id} post={s}/><strong>{s.hook || s.brief}</strong>
                            <span className="calendar-card-channel">{name(s.channel)}</span>
                            <span className={`plan-state state-${s.state}`}>
                              {labels[s.state]}
                            </span>
                            <span className="post-action-hint" aria-hidden="true">{canWrite || canReview ? 'Review & edit' : 'View post'} <span>→</span></span>
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
                        <span>{postFormatLabel(s)}</span>
                            <PostThumbnail businessId={business.id} post={s}/><strong>{s.hook || s.brief}</strong>
                        <span>{s.caption || s.brief}</span>
                        <span className={`plan-state state-${s.state}`}>
                          {labels[s.state]}
                          {s.has_newer_version
                            ? " · Newer creative version available"
                            : ""}
                        </span>
                        <span className="post-action-hint" aria-hidden="true">{canWrite || canReview ? 'Review & edit' : 'View post'} <span>→</span></span>
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

    </div>
  );
}
export function SlotPanel({
  business,
  slotId,
  moveTo,
  onChanged,
  onClose,
  onDirty,
}: {
  business: Business;
  slotId: string;
  moveTo?: {day:string;timezone:string};
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
    [referenceIds,setReferenceIds]=useState<string[]>([]),
    [reset, setReset] = useState(false),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false),
    [chosen, setChosen] = useState(""),
    [editing, setEditing] = useState(false),
    [editDesign, setEditDesign] = useState<Design>(),
    [editCaption, setEditCaption] = useState(""),
    [savedEdit, setSavedEdit] = useState<string>();
  const pendingMove = useRef(moveTo);
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
          let planned = d.slot.planned_at;
          const move = pendingMove.current;
          if(move){
            pendingMove.current=undefined;
            const options=localCandidates(move.day+localMinute(planned,move.timezone).slice(10),move.timezone);
            if(options.length===1){planned=options[0];setMessage('New date prepared. Review and save your changes to move this post. Social publishing is unchanged.');}
            else setMessage('This date has a daylight-saving time change. Choose the planned date and time below.');
          }
          setDraft({
            revision: d.slot.revision,
            brief: d.slot.brief,
            pillar: d.slot.pillar,
            hook: d.slot.hook,
            cta: d.slot.cta,
            video_draft: d.slot.video_draft,
            local: localMinute(planned, d.slot.timezone),
          });
          setChosen(planned);
          setReferenceIds(d.slot.reference_ids??[]);
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
  useEffect(()=>setReady(false),[s?.creative_version_id,s?.video_version_id,s?.carousel_version_id]);
  const referenceDirty=!!s&&JSON.stringify(referenceIds)!==JSON.stringify(s.reference_ids??[]);
  dirtyRef.current = dirty||referenceDirty||editing;
  useUnsavedChanges(dirty || !!feedback || busy || referenceDirty || editing);
  useEffect(
    () => onDirty(dirty || !!feedback || busy || referenceDirty || editing),
    [dirty, feedback, busy, referenceDirty, editing, onDirty],
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
    locked = busy || !canWrite || editing;
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
  async function saveDesign() {
    if (!editDesign || busy || !canWrite || (s.state === "approved" && !reset)) return;
    setBusy(true); setError(undefined);
    try {
      // Keep the saved version if attaching fails: retry only attachment, never duplicate the edit.
      const versionId = savedEdit || (await api(`${root}/creative-projects/${s.project_id}/versions`, {
        parent_id: s.creative_version_id, design: editDesign, caption: editCaption,
      })).id;
      setSavedEdit(versionId);
      await api(`${root}/content-slots/${slotId}`, {
        revision: s.revision, creative_version_id: versionId, reset_approval: reset,
      }, "PATCH");
      setEditing(false); setSavedEdit(undefined); setReset(false);
      setMessage("Design saved. Your updated post is ready for review.");
      await load(true); changed.current();
    } catch (e) { setError(e); await load(); }
    finally { setBusy(false); }
  }
  function review(decision: string) {
    if (editing) return;
    void act(
      () =>
        api(`${root}/reviews/${slotId}`, {
          revision: s.revision,
          creative_version_id: s.creative_version_id,
          creative_sha256: s.creative_sha256,
          video_version_id: s.video_version_id,
          video_sha256: s.video_sha256,
          carousel_version_id:s.carousel_version_id,carousel_sha256:s.carousel_sha256,
          decision,
          feedback,
        }),
      decision === "approved"
        ? "Approved this saved version. It has not been published."
        : decision === "reopen" ? "Review reopened. Approval was removed; this post needs review again." : "Review decision saved.",
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
      (dirty || feedback || referenceDirty || editing) &&
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
              {s.carousel_version_id ? <CalendarCarouselReview businessId={business.id} projectId={s.project_id} versionId={s.carousel_version_id} canEdit={canWrite} canReview={canReview} disabled={busy||dirty} onReady={setReady} onChanged={async()=>{await load(true);changed.current();}}/> : s.video_version_id ? <><VideoReview key={s.video_version_id} business={business} id={s.video_version_id} previewOnly onReady={setReady}/><a href={`/b/${business.id}/campaign-post?slot=${s.id}`}>Edit video</a></> : s.design ? (
                <>
                  {canWrite && !editing && s.state !== 'cancelled' && <div className="post-design-actions"><button className="primary" disabled={busy||dirty||referenceDirty||!!active||!!held||s.has_newer_version} onClick={()=>{setEditDesign(structuredClone(s.design));setEditCaption(s.caption||'');setSavedEdit(undefined);setEditing(true);}}>Edit design</button></div>}
                  <CreativeEditor
                    businessId={business.id}
                    design={editing && editDesign ? editDesign : s.design}
                    onChange={setEditDesign}
                    readOnly={!editing || busy || !!savedEdit}
                    previewOnly={!editing}
                    onExportReady={(fn) => setReady(!!fn)}
                  />
                  {canWrite && editing && s.state !== 'cancelled' && <div className="post-design-actions">
                    {<>
                      <Field label="Caption">{id=><textarea id={id} value={editCaption} maxLength={3000} disabled={busy||!!savedEdit} onChange={e=>setEditCaption(e.target.value)}/>}</Field>
                      {s.state==='approved'&&<label className="plan-select"><input type="checkbox" checked={reset} disabled={busy} onChange={e=>setReset(e.target.checked)}/>Save as a draft and review this updated design again.</label>}
                      {savedEdit&&<p role="status">Your design version is saved. Retry attaching it to this post, or close the editor and use Attach latest creative version.</p>}
                      <button className="primary" disabled={busy||(s.state==='approved'&&!reset)} onClick={()=>void saveDesign()}>{busy?'Saving…':savedEdit?'Attach saved design':'Save design'}</button>
                      <button disabled={busy} onClick={()=>{if(window.confirm(savedEdit?'Close the editor? Your saved version is retained.':'Discard unsaved design changes?')){setEditing(false);setSavedEdit(undefined);void load(true);}}}>Cancel editing</button>
                    </>}
                  </div>}
                  {canWrite&&<GeneratedReplacement key={`generated:${business.id}:${slotId}:${s.creative_version_id}`} businessId={business.id} projectId={s.project_id} parentId={s.creative_version_id} channel={s.channel} disabled={locked||dirty||referenceDirty||!!active||!!held||s.has_newer_version||s.state==='cancelled'} onReady={async()=>{setMessage('Replacement ready. Attach the latest version below when you are ready to review it.');await load(true);changed.current();}}/>}
                  {canWrite&&<StockPicker key={`${business.id}:${slotId}:${s.creative_version_id}`} businessId={business.id} purpose="replacement" disabled={locked||dirty||referenceDirty||!!active||!!held||s.has_newer_version||s.state==='cancelled'||(s.state==='approved'&&!reset)} onSelected={async referenceId=>{setBusy(true);setError(undefined);try{const saved=await api(`${root}/stock/projects/${s.project_id}/replace`,{parent_id:s.creative_version_id,reference_id:referenceId});await api(`${root}/content-slots/${slotId}`,{revision:s.revision,creative_version_id:saved.id,reset_approval:reset},'PATCH');setReset(false);setMessage('Photo replaced. This post is a draft ready for review.');await load(true);changed.current();}catch(e){await load(true);throw e;}finally{setBusy(false);}}}/> }
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
                  <a href={`/b/${business.id}/campaign-post?slot=${s.id}`}>
                    Open campaign editor
                  </a>
                </>
              ) : (
                <div className="plan-empty">
                  <h3>This idea needs a creative</h3>
                  {s.format==='video'&&!dirty&&<a href={`/b/${business.id}/campaign-post?slot=${s.id}`}>Create this video</a>}
                  <p>
                    {s.format==='video'?'Review your script below, then choose an approved reference image in the campaign editor.':'Create an image from the saved brief, then review it here.'}
                  </p>
                </div>
              )}
              {data?.videos?.map((run:any)=><div key={run.job_id}><p role="status">Video: {run.status.replaceAll('_',' ')}</p><a href={`/b/${business.id}/campaign-post?slot=${s.id}`}>Open video prompt and review</a>{run.output_version_id&&run.output_version_id!==s.video_version_id&&<button disabled={locked||dirty||(s.state==='approved'&&!reset)} onClick={()=>void act(()=>api(`${root}/content-slots/${slotId}`,{revision:s.revision,video_version_id:run.output_version_id,reset_approval:reset},'PATCH'),'Saved video attached as an unapproved draft.')}>Attach this saved video</button>}</div>)}
              {s.has_newer_version && (
                <div className="notice">
                  <p>
                    A newer creative version is available. This post still uses
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
                              [s.format==='carousel'?'carousel_version_id':s.format==='video'?'video_version_id':'creative_version_id']: s.latest_version_id,
                              reset_approval: reset,
                            },
                            "PATCH",
                          ),
                        "Latest creative version attached as an unapproved draft.",
                      )
                    }
                  >
                    Attach latest creative version
                  </button>
                </div>
              )}
            </div>
            <div className="post-review-controls" inert={editing || undefined}>
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

              <details className="post-brief-details" open={!s.creative_version_id&&!s.video_version_id&&!s.carousel_version_id||undefined}>
              <summary>Edit topic & schedule</summary>
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
              </details>
              <div className="slot-review">
                <h3>Create & review</h3>
                {canWrite&&s.format==='static'&&s.state!=='cancelled'&&<BrandReferences businessId={business.id} writable={false} selection={referenceIds} onSelectionChange={setReferenceIds} disabled={busy||active||held||dirty}/>}

                <Field label="Feedback or creative direction">
                  {(id) => (
                    <textarea
                      id={id}
                      maxLength={1600}
                      value={feedback}
                      disabled={busy || (!canWrite && !canReview)}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                  )}
                </Field>
                {dirty && (
                  <p>Save your post changes before creating or reviewing.</p>
                )}
                {canWrite && !["video","carousel"].includes(s.format) && s.state !== "cancelled" && (
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
                        reference_ids:referenceIds,
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
                        setReferenceIds([]);
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
                          busy || dirty || s.has_newer_version || !ready || (s.format==='carousel'&&s.carousel_status!=='approved')
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
                  {canReview&&['approved','rejected','changes_requested'].includes(s.state)&&<button disabled={busy||dirty} onClick={()=>review('reopen')}>Reopen review</button>}
                  {canWrite && s.state !== "cancelled" && (
                    <button
                      disabled={busy || dirty}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Archive this post? Its creative and history will be kept, and you can restore it as a draft. Active publishing requests must be managed in Publishing first.",
                          )
                        )
                          review("cancelled");
                      }}
                    >
                      Archive post
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
                        ? " · Plan changed. Review the saved creative draft before attaching it."
                        : ""}
                    </span>
                    {j.thread_id && (
                      <a
                        href={`/b/${business.id}/campaign-post?slot=${s.id}`}
                      >
                        Open saved creative
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
          {s.creative_version_id&&<CreativeExportPanel format={s.channel==='instagram'?'instagram-jpeg':'png'} key={business.id+s.id+s.creative_version_id+s.channel} business={business} versionId={s.creative_version_id} sourceSHA={s.creative_sha256} context={{type:'slot',id:s.id,revision:s.revision,state:s.state}} disabled={dirty||busy||!!feedback} onApproved={async()=>{await load(true);changed.current();}}/>}
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
