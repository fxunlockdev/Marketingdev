"use client";
import chatStyles from "./canvas-chat.module.css";
import {GeneratedReplacement} from "./generated-replacement";
import {GenerationNotification} from './generation-notification';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {canvasIntent,directedPrompt,type Creativity} from './creative-direction';
import {localMinute} from '../../api/src/local-calendar';
import {CanvasCarousels} from './carousels';
import {CanvasPlanner} from './canvas-planner';
import {CanvasVideos,CanvasVideoContext} from './video-canvas';
import {BrandReferences} from "./brand-references";
import {StockPicker} from "./stock-picker";
import { api } from "./api";
import { Field, Loading, Notice } from "./primitives";
import { CreativeEditor, type Design } from "./creative-editor";
import {CreativeExportPanel} from './creative-export';
import { useUnsavedChanges } from "./unsaved";
type Business = {
  id: string;
  organization_id: string;
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
  planning_runs: {id:string;status:string;cancel_requested:boolean;output_plan_id:string|null;scheduled_at:string;starts_on:string}[];
  projects: { id: string; title: string; latest_version_id: string | null }[];
};
type Version = {
  id: string;
  sha256: string;
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
    archived_at?: string | null;
    archive_revision: number;
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
  if(code==="MONTHLY_GENERATION_BUDGET_EXHAUSTED")return "You’ve used this month’s generation allowance. Your work is saved.";
  if (/CONFIG|GRANT|RUNTIME|STAGING_APPROVAL/.test(code))
    return "Image generation is not configured for this business yet. Your request has been saved.";
  if (/BUDGET/.test(code))
    return "This request exceeds the configured generation allowance.";
  if (/UNKNOWN|AMBIGUOUS/.test(code))
    return "The provider outcome is uncertain. Further generation is held until it is reconciled to avoid a duplicate charge.";
  if (/VERSION_CHANGED/.test(code))
    return "The creative changed while this request was running. Your newer edits have been preserved.";
  if (/REFERENCE_REVOKED/.test(code)) return "An image reference is no longer approved. Remove it from your selection before sending a new request.";
  if (/ACCESS/.test(code))
    return "Access changed before this request could finish.";
  return "This request could not finish. Your saved versions are still available.";
}
export function CanvasScreen({ business }: { business: Business }) {
  const root = `/api/v1/businesses/${business.id}`,
    [threads, setThreads] = useState<Thread[]>(),
    [assetsOpen,setAssetsOpen]=useState(false),
    [initialized,setInitialized]=useState(false),
    [threadId, setThreadId] = useState(""),
    [conversation, setConversation] = useState<Conversation>(),
    [projectId, setProjectId] = useState(""),
    [error, setError] = useState<unknown>(),
    [prompt, setPrompt] = useState(""),
    [referenceIds,setReferenceIds]=useState<string[]>([]),
    [channel, setChannel] = useState("instagram"),
    [creativity,setCreativity]=useState<Creativity>("normal"),
    [intent,setIntent]=useState("auto"),
    [carouselCount,setCarouselCount]=useState(3),
    [videoDuration,setVideoDuration]=useState(5),
    [hasCarousels,setHasCarousels]=useState(false),
    [openCarousels,setOpenCarousels]=useState(false),
    [planStart,setPlanStart]=useState(""),
    [format, setFormat] = useState("static"),
    [size, setSize] = useState("1024x1024"),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [edit, setEdit] = useState<{ version: Version; run: Run } | null>(null);
  const submitKey = useRef(crypto.randomUUID()),
    threadKey = useRef(crypto.randomUUID()),
    write = ['owner','admin','editor'].includes(business.role);
  useUnsavedChanges(dirty || !!prompt || busy || referenceIds.length>0);
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
              : "",
          );
          setInitialized(true);
        }
      })
      .catch((e) => active && setError(e));
    return () => {
      active = false;
    };
  }, [refreshThreads]);
  useEffect(() => {
    if(!initialized)return;
    const url=new URL(location.href);
    if(threadId)url.searchParams.set('thread',threadId);else url.searchParams.delete('thread');
    if(url.href!==location.href)history.replaceState(history.state,'',url);
  },[initialized,threadId]);
  useEffect(() => {
    if (!threadId) {
      setConversation(undefined);
      return;
    }
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if(document.hidden){timer=setTimeout(load,2500);return;}
      try {
        const value: Conversation = await api(
          root + `/canvas/threads/${threadId}`,
        );
        if (!active) return;
        setConversation(value);
        setProjectId((p) =>
          value.projects.some((x) => x.id === p)
            ? p
            : (value.projects.find(x=>x.id===new URLSearchParams(location.search).get("project")&&x.latest_version_id)?.id ?? value.projects.find((x) => x.latest_version_id)?.id ?? ""),
        );
        if (value.runs.some((r) => running(r))||value.planning_runs.some(r=>['queued','running','retrying'].includes(r.status)&&!r.cancel_requested&&Date.parse(r.scheduled_at)<=Date.now())) timer = setTimeout(load, 2500);
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
  const [planningDirty,setPlanningDirty]=useState(false),[videoDirty,setVideoDirty]=useState(false);
  const [videoReference,setVideoReference]=useState<{brand_reference_id:string;source_sha256:string;label:string}|null>(null);
  async function videoThread(){
    if(threadId)return threadId;
    const t=await api(root+"/canvas/threads",{title:"Product photo video"},"POST",threadKey.current);
    setThreadId(t.id);await refreshThreads();return t.id;
  }
  function choose(id: string) {
    if (id === threadId && id) return true;
    if (
      (dirty || prompt || planningDirty || videoDirty) &&
      !confirm("Leave your unsaved edits and draft message?")
    )
      return false;
    setVideoReference(null);
    setIntent("auto");
    setPlanningThread("");
    setThreadId(id);
    setConversation(undefined);
    setProjectId("");
    setEdit(null);
    setReferenceIds([]);
    setPrompt("");
    setDirty(false);
    setError(undefined);
    submitKey.current = crypto.randomUUID();
    threadKey.current = crypto.randomUUID();
    return true;
  }
  const [planningThread,setPlanningThread]=useState("");
  const held = conversation?.runs.some(
    (r) => running(r) || r.status === "unknown",
  );
  const requestType=edit?'image':intent==='auto'?canvasIntent(prompt):intent;
  useEffect(()=>{let active=true;void Promise.all([api(root+'/carousel-generations'),api(root+'/carousels')]).then(([v,c])=>{if(active)setHasCarousels(v.runs.length>0||c.carousels.length>0);}).catch(()=>{});return()=>{active=false;};},[root]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || dirty) return;
    setBusy(true);
    setError(undefined);
    try {
      const direction=directedPrompt(prompt,creativity);
      if(requestType==='plan'){
        const prefs=await api(root+'/onboarding');
        const result=await api(root+'/content-plan/generate',{canvas_thread_id:threadId||null,provider:'openai',brief:direction,planning_mode:'natural',starts_on:planStart||localMinute(Date.now(),prefs.timezone).slice(0,10),...(conversation?.planning_runs.find(r=>r.output_plan_id)?{reference_plan_id:conversation.planning_runs.find(r=>r.output_plan_id)!.output_plan_id}:{})},'POST',submitKey.current);
        if(result.thread_id){setThreadId(result.thread_id);setPlanningThread(result.thread_id);}
        await refreshThreads();
      }else if(requestType==='carousel'){
        const result=await api(root+'/carousel-generations',{prompt:direction,slide_count:carouselCount,channel,size,text_provider:'openai',reference_ids:referenceIds,...(conversation?.planning_runs.find(r=>r.output_plan_id)?{campaign_plan_id:conversation.planning_runs.find(r=>r.output_plan_id)!.output_plan_id}:{})},'POST',submitKey.current);
        setHasCarousels(true);setOpenCarousels(true);
        const saved=await api(root+'/carousel-generations');const run=saved.runs.find((r:any)=>r.id===result.id);if(run)setThreadId(run.thread_id);
        await refreshThreads();window.dispatchEvent(new Event('desvio-carousel-refresh'));
      }else{
      if(requestType==='video'&&!videoReference)throw new Error('Choose a photo in Brand image references, then select “Use for video”.');
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
      if(requestType==='video'){
        const slotId=new URLSearchParams(location.search).get('slot');
        const slot=slotId?(await api(root+'/content-slots/'+slotId)).slot:null;
        if(slot&&slot.format!=='video')throw new Error('Open a video post to create its video.');
        await api(root+`/canvas/threads/${id}/videos`,{prompt:direction,channel:slot?.channel??channel,text_provider:'openai',duration_seconds:videoDuration,...(slot?{slot_id:slot.id,slot_revision:slot.revision,...(slot.creative_spec?{creative_spec:slot.creative_spec}:{})}:{}),reference:{brand_reference_id:videoReference!.brand_reference_id,source_sha256:videoReference!.source_sha256,confirmed:true}},'POST',submitKey.current);
        window.dispatchEvent(new Event('desvio-video-refresh'));
      }else await api(
        root + `/canvas/threads/${id}/messages`,
        {
          prompt:direction,
          text_provider:"openai",
          channel: edit?.run.channel ?? channel,
          format: edit?.run.format ?? format,
          ...(edit?.version.skill_manifest?.creative_spec?{creative_spec:edit.version.skill_manifest.creative_spec}:{}),
          size: edit
            ? (edit.version.skill_manifest?.creative_spec?.aspect==='vertical'?'1024x1536':`${edit.version.design.width}x${edit.version.design.height}`)
            : size,
          parent_version_id: edit?.version.id ?? null,
          ...(referenceIds.length?{reference_ids:referenceIds}:{}),
        },
        "POST",
        submitKey.current,
      );
      }
      submitKey.current = crypto.randomUUID();
      setPrompt("");
      setReferenceIds([]);
      setEdit(null);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`canvas-chat-workspace ${chatStyles.workspace} ${!conversation?.messages.length&&!projectId?chatStyles.empty:""}`}>
      <header className={chatStyles.header}><h1>Canvas</h1><span>{business.name}</span>          <button disabled={!initialized || !write || busy} onClick={() => choose("")}>
            + New conversation
          </button>
</header>
      {!business.has_approved_brand && (
        <div className="availability-card">
          Confirm your brand profile first so each creative starts from approved
          facts.{" "}
          <a href={`/b/${business.id}/onboarding`}>Continue brand setup</a>
        </div>
      )}
      <Notice error={error} />
      <CanvasVideoContext businessId={business.id}/>

      <div className="studio-layout">
        <details className={chatStyles.conversations}><summary>Conversations</summary><aside className="studio-conversations" aria-label="Conversations">
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
                    {t.title.length>70 ? t.title.slice(0,67).trimEnd()+"…" : t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside></details>
        <div className="studio-main">
      {(hasCarousels||openCarousels)&&<div className="canvas-saved-work"><CanvasCarousels initiallyOpen={openCarousels} key={`${business.id}:${revision}`} businessId={business.id} onOpenSlide={(thread,project)=>{if(thread===threadId&&project!==projectId&&(dirty||prompt||planningDirty||videoDirty)&&!confirm("Leave your unsaved edits and draft message?"))return;if(choose(thread))setProjectId(project);}}/></div>}
      {threadId&&<CanvasVideos key={business.id+threadId} business={business} threadId={threadId}/>}
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
                        {p.title.split(/\s+Creative direction:/)[0]}
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
        <section className="studio-chat" aria-label="Creative conversation">
          <h2>
            {conversation?.planning_runs.length ? "Your campaign" : conversation?.thread.title ? (conversation.thread.title.length>70 ? conversation.thread.title.slice(0,67).trimEnd()+"…" : conversation.thread.title) : "Ready when you are."}
          </h2>
          {!!conversation?.messages.length&&<details className="conversation-history" open={!conversation?.planning_runs.length && !conversation?.projects.some(p=>p.latest_version_id)}><summary>Conversation & planning notes</summary><ol
            className="studio-messages"
            tabIndex={0}
            aria-label="Conversation messages"
          >
            {conversation?.messages.map((m) => (
              <li key={m.id} className={`studio-message ${m.role}`}>
                <strong>{m.role === "user" ? "You" : "Desvio"}</strong>
                <p>{m.role==='user'?m.content.split("\n\nCreative direction:")[0]:m.content}</p>
              </li>
            ))}
          </ol></details>}
          {!!conversation?.runs.length && (
            <div className="studio-runs" aria-label="Generation requests">
              {conversation.runs.slice(0, 5).map((r,index) => (
                <div key={r.id} className="studio-run">
                  <span role={running(r) ? "status" : undefined}>
                    {label(r.status)}
                    {r.cancel_requested && running(r)
                      ? " · cancellation requested"
                      : ""}
                  </span>
                  {r.error_code && r.status !== "canceled" && <p>{problem(r.error_code)}</p>}
                  {write&&index===0&&<GenerationNotification businessId={business.id} jobIds={[r.id]}/>}
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
          {!!conversation?.planning_runs.length&&<section aria-label="Conversation plans">{conversation.planning_runs.map(r=><p key={r.id}>{r.output_plan_id?<a href={`/b/${business.id}/content-plan?start=${r.starts_on}`}>Open calendar · {r.starts_on}</a>:r.cancel_requested?'Planning canceled':r.status==='queued'&&Date.parse(r.scheduled_at)>Date.now()?`Planning scheduled for ${r.starts_on}`:r.status==='unknown'?'Planning needs reconciliation before another request.':`Planning ${r.status}`}</p>)}</section>}
          {initialized&&<CanvasPlanner key={`planner:${business.id}:${threadId}:${revision}`} business={business} threadId={typeof window!=="undefined"&&new URLSearchParams(location.search).has("firstPlan")?undefined:threadId} onDirty={setPlanningDirty} chatOnly initiallyOpen={(typeof window!=="undefined"&&new URLSearchParams(location.search).has("firstPlan"))||(planningThread===threadId&&!!threadId)||!!conversation?.planning_runs.length} disabled={busy||dirty} onSubmitted={id=>{setPlanningThread(id);setThreadId(id);setRevision(n=>n+1);void refreshThreads().catch(setError);}}/>}
          <div id="canvas-assets" hidden={!assetsOpen} className={chatStyles.assets}>
          <BrandReferences key={`references:${business.id}`} businessId={business.id} writable={write} uploadWorkspace={{id:business.organization_id,name:business.name,role:business.role}} onVideo={reference=>{if(videoDirty&&!confirm("Replace the selected photo and discard its unsaved video idea?"))return;setVideoReference(reference);setIntent("video");submitKey.current=crypto.randomUUID();}} selection={referenceIds} onSelectionChange={ids=>{setReferenceIds(ids);submitKey.current=crypto.randomUUID();}} disabled={!initialized||!write||busy||held}/>
          </div>
          <form className="studio-composer" onSubmit={send}>
            <fieldset
              disabled={!initialized || !write || busy || held || !business.has_approved_brand}
            >
              <legend className={chatStyles.srOnly}>{edit ? "Revise this image" : "Message Desvio"}</legend>
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
              <div className={chatStyles.prompt}><Field
                label={
                  edit ? "Describe your changes" : "Describe your creative"
                }
              >
                {(id) => (
                  <textarea
                    id={id}
                    required
                    rows={1}
                    maxLength={1600}
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      submitKey.current = crypto.randomUUID();
                    }}
                    placeholder="Ask Desvio to create something…"
                  />
                )}
              </Field></div>
              <div className={chatStyles.toolbar}><button type="button" className={chatStyles.add} aria-label="Add assets" aria-controls="canvas-assets" aria-expanded={assetsOpen} onClick={()=>setAssetsOpen(value=>!value)}>+</button>
              <div className="studio-options">
              <Field label="Creativity">{id=><select id={id} value={creativity} onChange={e=>{setCreativity(e.target.value as Creativity);submitKey.current=crypto.randomUUID();}}><option value="normal">Normal</option><option value="creative">Creative</option><option value="super">Super creative</option></select>}</Field>

              </div>
              <button className={`primary ${chatStyles.send}`} disabled={!prompt.trim()||dirty} type="submit" aria-label={busy?"Saving request…":edit?"Generate revision":"Send"}><span aria-hidden="true">↑</span></button></div>
              <details className={chatStyles.more} open={requestType!=="image"}><summary>Options</summary>
              {!edit&&<Field label="Create">{id=><select id={id} value={intent} onChange={e=>{setIntent(e.target.value);submitKey.current=crypto.randomUUID();}}><option value="auto">Auto</option><option value="image">Image</option><option value="plan">Content plan</option><option value="carousel">Carousel</option><option value="video">Video</option></select>}</Field>}
              {!edit&&<p className="composer-intent">{requestType==='plan'?'Planning your content':requestType==='video'?'Drafting a video script for your review':requestType==='carousel'?'Creating a carousel':'Creating an image'}</p>}
              {requestType==='plan'&&<Field label="Plan starts on (optional)">{id=><input id={id} type="date" value={planStart} onChange={e=>{setPlanStart(e.target.value);submitKey.current=crypto.randomUUID();}}/>}</Field>}
              {requestType==='carousel'&&<Field label="Slides">{id=><input id={id} type="number" min={2} max={10} value={carouselCount} onChange={e=>{setCarouselCount(Number(e.target.value));submitKey.current=crypto.randomUUID();}}/>}</Field>}
              {requestType==='video'&&<><Field label="Video length (seconds)">{id=><input id={id} type="number" min={3} max={15} value={videoDuration} onChange={e=>{setVideoDuration(Number(e.target.value));submitKey.current=crypto.randomUUID();}}/>}</Field><p>{videoReference?`Using ${videoReference.label}`:'Choose an uploaded photo above to start.'}</p></>}
              {!edit && requestType!=="plan" && (
                <div className="composer-settings"><div className="studio-options">
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
                        <option value="linkedin">LinkedIn</option><option value="facebook">Facebook</option>
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
                </div><button type="button" onClick={()=>{setHasCarousels(true);setOpenCarousels(true);}}>Combine saved images into a carousel</button></div>
              )}
              </details>
            </fieldset>
            {dirty && (
              <p className="hint">
                Save your creative edits before generating another version.
              </p>
            )}
            {!write && (
              <p className="hint">You have view access to this business.</p>
            )}

          </form>
          {!conversation?.messages.length&&<div className={chatStyles.suggestions} aria-label="Creative suggestions">{["Create an image for my next launch","Plan a week of content","Turn a product photo into a video"].map(idea=><button key={idea} type="button" disabled={busy||!initialized||!write} onClick={()=>{setPrompt(idea);submitKey.current=crypto.randomUUID();document.querySelector<HTMLTextAreaElement>(".studio-composer textarea")?.focus();}}>{idea}<span aria-hidden="true">↗</span></button>)}</div>}
        </section>
        </div>
      </div>

    </div>
  );
}
export function CreativeProject({
  business,
  projectId,
  refresh = "",
  onDirty = () => {},
  onRevision,
  chatLayout = false,
  canvasDetails,
  onDisplayed,
  editingDisabled = false,
}: {
  business: Business;
  projectId: string;
  refresh?: string;
  onDirty?: (v: boolean) => void;
  onRevision?: (v: Version) => void;
  chatLayout?: boolean;
  canvasDetails?: React.ReactNode;
  onDisplayed?: (id:string) => void;
  editingDisabled?: boolean;
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
    write = ['owner','admin','editor'].includes(business.role) && !data?.project.archived_at,
    reviewer = ["owner", "admin", "reviewer"].includes(business.role) && !data?.project.archived_at;
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty || !!feedback || busy);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  useEffect(() => {
    onDirtyRef.current(dirty || busy);
    return () => onDirtyRef.current(false);
  }, [dirty,busy]);
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
  async function changeArchive() {
    if (!data || dirty || busy) return;
    setBusy(true);setError(undefined);
    try {
      const archived=!!data.project.archived_at;
      await api(root+`/creative-projects/${projectId}/${archived?'restore':'archive'}`,{revision:data.project.archive_revision});
      await load(selected);
      setNotice(archived?'Creative restored. Nothing has been scheduled or published.':'Creative archived. All saved versions are retained.');
    } catch(e){setError(e);}finally{setBusy(false);}
  }
  const exportReady = useCallback(
    (fn: (() => void) | null) => setDownload(() => fn),
    [],
  );
  useEffect(()=>{if(download&&version)onDisplayed?.(version.id);},[download,version?.id,onDisplayed]);
  if (!data || !version || !design)
    return (
      <>
        <Notice error={error} />
        {!error && <Loading />}
      </>
    );
  if (chatLayout) return (
    <article className="creative-project chat-creative-project" aria-label="Canvas artwork editor">
      <Notice error={error} />
      {notice && <p role="status">{notice}</p>}
      {data.project.archived_at && <p role="status">Archived creative · open Post details to restore it.</p>}
      <CreativeEditor
        businessId={business.id}
        design={design}
        onChange={setDesign}
        readOnly={!write || !latest || busy || editingDisabled}
        chatControls
        afterArtwork={<div className="conversation-canvas-strip" aria-label="Creative details">{canvasDetails}<strong>{dirty?"Unsaved changes":label(version.status)}</strong></div>}
        controlsFooter={<>
          <button className="chat-download" disabled={!download||busy||dirty} onClick={()=>{try{download?.();}catch{setError(new Error("The image could not be exported. Reload and retry."));}}}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>Download PNG</button>
          {write&&latest&&dirty&&<div className="chat-save-actions">
            <button className="primary" disabled={busy||editingDisabled} onClick={save}>{busy?"Saving…":"Save changes"}</button>
            <button disabled={busy||editingDisabled} onClick={()=>{setDesign(structuredClone(version.design));setCaption(version.caption);setNotice('');}}>Discard edits</button>
          </div>}
        </>}
        onExportReady={exportReady}
      />
    </article>
  );
  return (
    <article className="creative-project">
      {data.project.archived_at && <p role="status">Archived creative · restore it to make changes.</p>}
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
      {["owner","admin","editor"].includes(business.role) && <button className="creative-archive-action" disabled={busy||dirty} onClick={changeArchive}>{data.project.archived_at?"Restore creative":"Archive creative"}</button>}
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
        readOnly={!write || !latest || busy || editingDisabled}
        onExportReady={exportReady}
      />
      {write&&latest&&<GeneratedReplacement key={`generated:${business.id}:${projectId}:${version.id}`} businessId={business.id} projectId={projectId} parentId={version.id} disabled={dirty||busy} onReady={async id=>{await load(id);setNotice('Your new photo is ready to review.');}}/>}
      {write&&latest&&<StockPicker key={`${business.id}:${projectId}:${version.id}`} businessId={business.id} purpose="replacement" disabled={dirty||busy} onSelected={async referenceId=>{setBusy(true);try{const saved=await api(root+`/stock/projects/${projectId}/replace`,{parent_id:version.id,reference_id:referenceId});await load(saved.id);setNotice('Photo replaced in a new draft. Review the result before using it in a post.');}finally{setBusy(false);}}}/>}
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
        {(write || reviewer) && latest && !dirty && (
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
              {write && ["draft", "changes_requested"].includes(version.status) && (
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
      <CreativeExportPanel threadId={data.project.thread_id} key={business.id+version.id} business={business} versionId={version.id} sourceSHA={version.sha256} context={{type:'canvas',id:version.id,revision:version.review_revision,state:version.status}} disabled={dirty||busy||!latest||!!data.project.archived_at} onApproved={async()=>{await load(selected);setFeedback('');setNotice('This saved version is approved. It has not been published.');}}/>
    </article>
  );
}
