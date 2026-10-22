"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';
type Business={id:string;role:string};
const active=(status:string)=>['queued','running','retrying'].includes(status);
export function VideoRequest({business,threadId,reference}:{business:Business;threadId:string;reference:{export_id:string;approval_id:string;source_sha256:string;export_sha256:string}}){
 const [prompt,setPrompt]=useState(''),[duration,setDuration]=useState(5),[channel,setChannel]=useState('instagram'),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[notice,setNotice]=useState('');
 const key=useRef(crypto.randomUUID());useUnsavedChanges(!!prompt||busy);
 useEffect(()=>{let valid=true;void api(`/api/v1/businesses/${business.id}/videos`).then(v=>{if(valid)setEnabled(v.configured);}).catch(e=>{if(valid)setError(e);});return()=>{valid=false;};},[business.id]);
 async function submit(){setBusy(true);setError(undefined);try{await api(`/api/v1/businesses/${business.id}/canvas/threads/${threadId}/videos`,{prompt,channel,duration_seconds:duration,reference:{...reference,confirmed:true}},'POST',key.current);key.current=crypto.randomUUID();setPrompt('');setNotice('Preparing your video script. Review and approve its prompt in Videos before generation.');window.dispatchEvent(new Event('desvio-video-refresh'));}catch(e){setError(e);}finally{setBusy(false);}}
 return <details><summary>Make a video from this approved image</summary>
 <p>First draft a script and prompt. Video generation starts only after you approve that draft. Drafting uses your text-model allowance.</p>
 {error!==undefined&&<Notice error={error}/>}<p role="status">{notice}</p>
 {!enabled?<p>Video generation is not configured yet.</p>:<fieldset disabled={busy||business.role==='viewer'}>
 <Field label="Video idea">{id=><textarea id={id} value={prompt} maxLength={4000} onChange={e=>{setPrompt(e.target.value);key.current=crypto.randomUUID();}}/>}</Field>
 <Field label="Video length (seconds)">{id=><input id={id} type="number" min={3} max={15} value={duration} onChange={e=>{setDuration(Number(e.target.value));key.current=crypto.randomUUID();}}/>}</Field>
 <Field label="Video channel">{id=><select id={id} value={channel} onChange={e=>{setChannel(e.target.value);key.current=crypto.randomUUID();}}><option value="instagram">Instagram</option><option value="linkedin">LinkedIn</option></select>}</Field>
 <button type="button" disabled={!prompt.trim()||duration<3||duration>15} onClick={()=>void submit()}>{busy?'Preparing…':'Draft video script'}</button>
 </fieldset>}</details>;
}
export function CanvasVideos({business,threadId}:{business:Business;threadId:string}){
 const [state,setState]=useState<any>(),[error,setError]=useState<unknown>();const root=`/api/v1/businesses/${business.id}`;
 const load=useCallback(async()=>setState(await api(root+'/videos')),[root]);
 useEffect(()=>{let alive=true;let timer:ReturnType<typeof setTimeout>;const refresh=()=>{void api(root+'/videos').then(v=>{if(!alive)return;setState(v);if(v.runs.some((r:any)=>active(r.status)))timer=setTimeout(refresh,3000);}).catch(e=>{if(alive)setError(e);});};const changed=()=>{clearTimeout(timer);refresh();};refresh();window.addEventListener('desvio-video-refresh',changed);return()=>{alive=false;clearTimeout(timer);window.removeEventListener('desvio-video-refresh',changed);};},[root,threadId]);
 const projects=state?.projects.filter((p:any)=>p.thread_id===threadId)??[];
 if(!projects.length&&error===undefined)return null;
 return <section className="studio-projects" aria-label="Videos"><h2>Videos</h2>{error!==undefined&&<Notice error={error}/>}
 {projects.map((p:any)=>{const run=state.runs.find((r:any)=>r.project_id===p.id);return <article key={p.id} className="creative-review"><h3>{p.title}</h3>
 {run?.awaiting_approval&&!run.cancel_requested&&<VideoDraft key={run.id+run.draft_revision} business={business} jobId={run.id} onSaved={load}/>}
 {run&&!run.awaiting_approval&&!p.latest_version_id&&<p role="status">{run.approved_revision&&active(run.status)?'Generating your approved video…':active(run.status)?'Preparing your script and prompt…':run.status==='unknown'?'Generation needs reconciliation before another paid request.':`Video ${run.status}. Your saved work is retained.`}</p>}
 {run&&active(run.status)&&business.role!=='viewer'&&<button type="button" disabled={run.cancel_requested} onClick={()=>void api(`${root}/video-jobs/${run.id}/cancel`,{}).then(load).catch(setError)}>{run.cancel_requested?'Canceling video request…':'Cancel video request'}</button>}
 {p.latest_version_id&&<VideoHistory business={business} latest={p.latest_version_id} versions={state.versions.filter((v:any)=>v.project_id===p.id)}/>}</article>;})}</section>;
}
function VideoDraft({business,jobId,onSaved}:{business:Business;jobId:string;onSaved:()=>Promise<void>}){
 const [draft,setDraft]=useState<any>(),[brief,setBrief]=useState<any>(),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[confirmed,setConfirmed]=useState(false);
 const root=`/api/v1/businesses/${business.id}/video-jobs/${jobId}/draft`;useUnsavedChanges(dirty||busy);
 useEffect(()=>{let valid=true;void api(root).then(v=>{if(valid){setDraft(v);setBrief(v.brief);}}).catch(e=>{if(valid)setError(e);});return()=>{valid=false;};},[root]);
 const change=(value:any)=>{setBrief(value);setDirty(true);setConfirmed(false);};
 async function save(approve:boolean){setBusy(true);setError(undefined);try{await api(root,{brief,revision:draft.draft_revision,approve});setDirty(false);await onSaved();window.dispatchEvent(new Event('desvio-video-refresh'));}catch(e){setError(e);}finally{setBusy(false);}}
 return <section aria-label="Video prompt approval"><h4>Review before video generation</h4>{error!==undefined&&<Notice error={error}/>}<p>No video request is sent until this prompt is approved.</p>
 {brief?<fieldset disabled={busy||business.role==='viewer'}>
 <Field label="Video title">{id=><input id={id} value={brief.title} maxLength={140} onChange={e=>change({...brief,title:e.target.value})}/>}</Field>
 <Field label="Video prompt">{id=><textarea id={id} value={brief.video_prompt} maxLength={8000} onChange={e=>change({...brief,video_prompt:e.target.value})}/>}</Field>
 <Field label="Post caption">{id=><textarea id={id} value={brief.caption} maxLength={3000} onChange={e=>change({...brief,caption:e.target.value})}/>}</Field>
 <h4>Script and storyline</h4>{brief.beats.map((beat:any,i:number)=><div key={i}><p>{beat.start_ms/1000}–{beat.end_ms/1000} seconds</p><Field label={`Scene ${i+1} action`}>{id=><textarea id={id} value={beat.action} maxLength={800} onChange={e=>change({...brief,beats:brief.beats.map((b:any,n:number)=>n===i?{...b,action:e.target.value}:b)})}/>}</Field><Field label={`Scene ${i+1} camera`}>{id=><input id={id} value={beat.camera} maxLength={300} onChange={e=>change({...brief,beats:brief.beats.map((b:any,n:number)=>n===i?{...b,camera:e.target.value}:b)})}/>}</Field></div>)}
 {brief.overlays.map((o:any,i:number)=><Field key={i} label={`On-screen text ${i+1} (${o.start_ms/1000}–${o.end_ms/1000}s)`}>{id=><input id={id} value={o.text} maxLength={90} onChange={e=>change({...brief,overlays:brief.overlays.map((b:any,n:number)=>n===i?{...b,text:e.target.value}:b)})}/>}</Field>)}
 <button type="button" disabled={!dirty} onClick={()=>void save(false)}>Save video draft</button>
 {['owner','admin'].includes(business.role)&&<><label className="check-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I approve this prompt and authorize video generation using the configured allowance.</label><button type="button" disabled={!confirmed} onClick={()=>void save(true)}>Approve prompt and generate video</button></>}
 </fieldset>:<p role="status">Loading video draft…</p>}</section>;
}
function VideoHistory({business,latest,versions}:{business:Business;latest:string;versions:any[]}){
 const [selected,setSelected]=useState(latest);useEffect(()=>setSelected(latest),[latest]);
 return <><Field label="Saved video version">{id=><select id={id} value={selected} onChange={e=>setSelected(e.target.value)}>{versions.map((v,i)=><option key={v.id} value={v.id}>{v.id===latest?'Latest':'Previous'} · {v.status.replaceAll('_',' ')} · {new Date(v.created_at).toLocaleString()}</option>)}</select>}</Field><VideoReview key={selected} business={business} id={selected} historical={selected!==latest}/></>;
}
function VideoReview({business,id,historical=false}:{business:Business;id:string;historical?:boolean}){
 const root=`/api/v1/businesses/${business.id}/video-versions/${id}`;const requestKey=useRef(crypto.randomUUID());const [version,setVersion]=useState<any>(),[url,setUrl]=useState(''),[loaded,setLoaded]=useState(false),[feedback,setFeedback]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();useUnsavedChanges(!!feedback||busy);
 useEffect(()=>{let valid=true,blob='';const controller=new AbortController();void(async()=>{const v=await api(root),grant=await api(root+'/download');const response=await fetch(grant.url,{signal:controller.signal,cache:'no-store'});if(!response.ok)throw new Error('Could not load the saved video.');const bytes=await response.arrayBuffer();if(bytes.byteLength>64*1024*1024||bytes.byteLength!==grant.bytes)throw new Error('Video integrity check failed.');const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(sha!==v.sha256||sha!==grant.sha256)throw new Error('Video integrity check failed.');if(valid){blob=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));setVersion(v);setUrl(blob);}})().catch(e=>{if(valid)setError(e);});return()=>{valid=false;controller.abort();if(blob)URL.revokeObjectURL(blob);};},[root]);
 async function review(decision:string){setBusy(true);setError(undefined);try{await api(root+'/review',{decision,feedback,revision:version.review_revision,sha256:version.sha256,confirmed});setVersion(await api(root));setFeedback('');setConfirmed(false);}catch(e){setError(e);}finally{setBusy(false);}}
 async function regenerate(){setBusy(true);setError(undefined);try{await api(root+'/regenerate',{feedback},'POST',requestKey.current);requestKey.current=crypto.randomUUID();setFeedback('');window.dispatchEvent(new Event('desvio-video-refresh'));}catch(e){setError(e);}finally{setBusy(false);}}
 return <section aria-label="Video review">{error!==undefined&&<Notice error={error}/>}<p role="status">{version?.status.replaceAll('_',' ')??'Loading saved video…'}</p>
 {url&&<><video controls preload="auto" src={url} aria-label="Saved video preview" onLoadedData={()=>setLoaded(true)} onError={()=>setError(new Error('The saved video could not be played.'))} style={{width:'100%',maxWidth:640,maxHeight:480,aspectRatio:`${version.width}/${version.height}`}}/><p>{version.caption}</p><a href={url} download="desvio-video.mp4">Download video</a></>}
 {historical&&<p>This previous version is kept for reference. Select the latest version to give feedback or approve.</p>}{version&&!historical&&business.role!=='viewer'&&<fieldset disabled={busy}><Field label="Video feedback">{field=><textarea id={field} value={feedback} maxLength={2000} onChange={e=>{setFeedback(e.target.value);requestKey.current=crypto.randomUUID();}}/>}</Field>
 <button type="button" disabled={!feedback.trim()} onClick={()=>void regenerate()}>Draft a revised video from feedback</button><p>Your existing clip is kept. Review the new prompt before generating another video.</p>
 {['draft','changes_requested'].includes(version.status)&&<button type="button" onClick={()=>void review('in_review')}>Send video for review</button>}
 {version.status==='in_review'&&['owner','admin'].includes(business.role)&&<><label className="check-row"><input type="checkbox" disabled={!loaded} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this saved video and caption.</label><button type="button" disabled={!loaded||!confirmed} onClick={()=>void review('approved')}>Approve final video</button><button type="button" onClick={()=>void review('changes_requested')}>Request video changes</button><button type="button" onClick={()=>void review('rejected')}>Reject video</button></>}
 </fieldset>}{version?.reviews?.filter((r:any)=>r.feedback).map((r:any)=><blockquote key={r.revision}><strong>{r.decision.replaceAll('_',' ')}</strong><p>{r.feedback}</p></blockquote>)}</section>;
}
