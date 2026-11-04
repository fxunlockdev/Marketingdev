"use client";
import {createPortal} from 'react-dom';
import {ChatVideoSetup} from './chat-video-setup';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {CampaignImages} from './campaign-images';
import {CampaignPostScreen} from './campaign-post';
import {Notice} from './primitives';
import {CreativeProject} from './canvas';
import {CanvasCarousels,CarouselImage} from './carousels';
import {ChatFormatPreview} from './chat-format-preview';
import {CanvasVideos,VideoReview} from './video-canvas';
type Business={id:string;name:string;role:string;has_approved_brand:boolean;organization_id?:string};
const active=(status:string)=>['queued','running','retrying'].includes(status);
export function ChatCarousel({business,run,slides,onDirty,onRefresh}:{business:Business;run:any;slides:any[];onDirty:(dirty:boolean)=>void;onRefresh:()=>void}){
 const [detail,setDetail]=useState<any>(),[position,setPosition]=useState(0),[editing,setEditing]=useState(false),[error,setError]=useState<unknown>(),[loadError,setLoadError]=useState<unknown>(),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{if(run.output_version_id){setDetail(await api(`/api/v1/businesses/${business.id}/carousels/${run.project_id}`));setLoadError(undefined);}},[business.id,run.project_id,run.output_version_id]);
 useEffect(()=>{void load().catch(setLoadError);},[load,revision]);
 const version=detail?.versions.find((v:any)=>v.id===detail.project.latest_version_id),page=version?.pages[position],slide=slides[position],ready=slides.filter(s=>s.export_status==='succeeded').length;
 const onReady=useCallback(()=>{},[]),writable=['owner','admin','editor'].includes(business.role);
 return <section className="chat-media" aria-label="Your carousel"><header><div><p className="hint">Carousel · {slides.length||run.slide_count} slides</p><h2>{version?.title??'Building your story'}</h2></div><span className="badge">{run.status==='succeeded'?'Draft':run.status==='unknown'?'Needs attention':active(run.status)?'Creating':run.status}</span></header><Notice error={error}/>{!!loadError&&<div className="conversation-recovery"><Notice error={loadError}/><button onClick={()=>void load().catch(setLoadError)}>Reload saved carousel</button></div>}
 {run.status!=='succeeded'&&<div className="conversation-workflow" role="status"><strong>{ready} of {slides.length||run.slide_count} slides saved</strong><progress value={ready} max={slides.length||Number(run.slide_count)} aria-label="Saved carousel slides"/><p>{active(run.status)?'Your slides will appear here as they finish. You can return through History.':run.status==='unknown'?'The provider result needs reconciliation. Another paid request will not start automatically.':'Generation stopped. Completed slides are preserved below.'}</p>{writable&&active(run.status)&&<button disabled={busy||run.cancel_requested} onClick={async()=>{setBusy(true);try{await api(`/api/v1/businesses/${business.id}/carousel-generations/${run.id}/cancel`,{});onRefresh();}catch(e){setError(e);}finally{setBusy(false);}}}>{run.cancel_requested?'Canceling…':'Cancel generation'}</button>}</div>}
 <nav className="chat-slide-tabs" aria-label="Carousel slides">{slides.map((s,i)=><button key={s.project_id} aria-pressed={position===i} onClick={()=>{if(editing&&!window.confirm('Leave the slide editor? Save any changes first.'))return;setEditing(false);onDirty(false);setPosition(i);}}>Slide {i+1}<small>{s.export_status==='succeeded'?'Ready':s.generation_status==='succeeded'?'Saving':s.generation_status}</small></button>)}</nav>
 {editing&&slide?.output_version_id?<><button onClick={()=>{if(!window.confirm('Close the slide editor? Save any changes first.'))return;setEditing(false);onDirty(false);setRevision(n=>n+1);}}>Back to carousel</button><CreativeProject business={{...business,organization_id:business.organization_id??''}} projectId={slide.project_id} refresh={slide.output_version_id} chatLayout onDirty={onDirty} onSaved={()=>{setRevision(n=>n+1);onRefresh();}} editingDisabled={active(run.status)}/></>:page?<figure className="chat-carousel-preview"><CarouselImage businessId={business.id} page={page} onReady={onReady}/><figcaption>Slide {position+1} of {version.pages.length}</figcaption></figure>:slide?.output_version_id?<CreativeProject business={{...business,organization_id:business.organization_id??''}} projectId={slide.project_id} refresh={slide.output_version_id} chatLayout editingDisabled onDirty={onDirty}/>:<div className="chat-slide-placeholder" role="status">{active(run.status)?`Creating slide ${position+1}…`:'This slide did not finish.'}</div>}
 {!editing&&page&&writable&&<button onClick={()=>setEditing(true)}>Edit slide {position+1}</button>}
 {version&&!editing&&<><p>{version.caption}</p><details className="chat-media-details"><summary>Caption, slide order & review</summary><CanvasCarousels key={`${run.project_id}:${revision}`} businessId={business.id} projectId={run.project_id} initiallyOpen onDirty={onDirty} onOpenSlide={(_,project)=>{const next=slides.findIndex(s=>s.project_id===project);if(next>=0){setPosition(next);setEditing(true);}}}/></details></>}
 </section>;
}
export function ChatVideo({business,threadId,turn,chatTarget}:{business:Business;threadId:string;turn:any;chatTarget?:HTMLElement|null}){
 const [management,setManagement]=useState(false);
 const [state,setState]=useState<any>(),[error,setError]=useState<unknown>();
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const v=await api(`/api/v1/businesses/${business.id}/videos`);if(live){setState(v);setError(undefined);}}catch(e){if(live)setError(e);}if(live)timer=setTimeout(load,3000);};void load();return()=>{live=false;clearTimeout(timer);};},[business.id,threadId]);
 const placement=turn.output.placement??'feed',title=placement==='reel'?'reel':placement==='story'?'video story':'video';
 const project=state?.projects.find((p:any)=>p.thread_id===threadId&&new Date(p.created_at)>=new Date(turn.created_at));
 const started=!!project,run=state?.runs.find((r:any)=>r.project_id===project?.id),version=state?.versions.find((v:any)=>v.id===project?.latest_version_id);
 const scriptFailed=run?.status==='rejected'&&run.error_code==='VIDEO_PLAN_OUTPUT_INVALID';
 const videoStatus=scriptFailed?'Script needs attention':run?.cancel_requested&&active(run.status)?'Canceling':run?.awaiting_approval&&active(run.status)?'Review script':run&&active(run.status)?'Creating':run?.status==='unknown'?'Needs attention':run?.status==='failed'?'Generation stopped':run?.status??'Draft';
 const conversation=<section className="chat-video-dialogue" aria-label="Video conversation"><Notice error={error}/>
 {!state?<p role="status">Checking video availability…</p>:!state.configured?<p role="status">Video generation is unavailable for this workspace. Your conversation is saved.</p>:!started&&<ChatVideoSetup business={business} threadId={threadId} turn={turn} onSubmitted={()=>void api(`/api/v1/businesses/${business.id}/videos`).then(setState).catch(setError)}/>}
 {project?.latest_version_id&&<div className="create-message assistant"><span className="create-avatar" aria-hidden="true">d.</span><p>Your video is ready in the canvas. Play it to review the result, or open the controls below to request changes.</p></div>}
 {project?.latest_version_id?<details className="chat-video-management" onToggle={e=>{if(e.currentTarget.open)setManagement(true);}}><summary>Edit, review & history</summary>{management&&<CanvasVideos business={business} threadId={threadId} projectId={project?.id} compact conversational/>}</details>:project?<CanvasVideos business={business} threadId={threadId} projectId={project.id} compact conversational/>:null}
 </section>;
 return <section className="chat-media chat-video" aria-label={`Your ${title}`}>
 {!project?.latest_version_id?<ChatFormatPreview kind={placement==='feed'?'video':placement} brand={business.name} shape={turn.output.size==='1024x1024'?'square':turn.output.size==='1024x1536'?'portrait':'landscape'} channel={turn.output.channel} status={videoStatus}/>:<ChatFormatPreview kind={placement==='feed'?'video':placement} brand={business.name} channel={turn.output.channel} status={run&&active(run.status)?'Revising':version?.status?.replaceAll('_',' ')??'Draft'}><div className="chat-saved-video"><VideoReview key={project.latest_version_id} business={business} id={project.latest_version_id} previewOnly/></div></ChatFormatPreview>}
 {!project?.latest_version_id&&<p className="chat-video-preview-hint">{started?'Your video will appear here when it is ready.':'Choose your starting image in the conversation to begin.'}</p>}
 {chatTarget?createPortal(conversation,chatTarget):conversation}
 </section>;
}

/** Resume the exact saved guided post; never create a replacement calendar slot. */
export function ChatPlannedPost({business,slotId}:{business:Business;slotId:string}){
 const [data,setData]=useState<any>(),[error,setError]=useState<unknown>(),[refresh,setRefresh]=useState(0),[dirty,setDirty]=useState(false);
 useEffect(()=>{let live=true,timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const value=await api(`/api/v1/businesses/${business.id}/content-slots/${slotId}`);if(live){setData(value);setError(undefined);}}catch(e){if(live)setError(e);}if(live)timer=setTimeout(load,3000);};void load();return()=>{live=false;clearTimeout(timer);};},[business.id,slotId,refresh]);
 const slot=data?.slot,run=data?.carousel_runs?.[0],onRefresh=()=>setRefresh(n=>n+1);
 return <section className="chat-media" aria-label="Your planned creative"><Notice error={error}/>{!slot?<p role="status">Loading your saved post…</p>:slot.format==='video'?<CampaignPostScreen business={{...business,organization_id:business.organization_id??''}} selectedSlot={slotId}/>:<>
 <CampaignImages automatic reviewed compact businessId={business.id} planId={slot.plan_id} slots={[slot]} disabled={dirty||!['owner','admin','editor'].includes(business.role)} onRefresh={onRefresh}/>
 {run?<ChatCarousel business={business} run={run} slides={(data.carousel_slides??[]).filter((s:any)=>s.parent_job_id===run.id)} onDirty={setDirty} onRefresh={onRefresh}/>:slot.project_id?<CreativeProject business={{...business,organization_id:business.organization_id??''}} projectId={slot.project_id} refresh={slot.latest_version_id} chatLayout onDirty={setDirty} onSaved={onRefresh}/>:<p role="status">Your {slot.format==='carousel'?'carousel':'image'} will appear here when it is saved.</p>}
 </>}</section>;
}
