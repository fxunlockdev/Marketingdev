"use client";
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {api} from './api';
import {Button} from './ui/button';
import {StatusBadge,type Status} from './ui/status-badge';
import {MediaImage} from './media-image';
import {DesvioSelect} from './desvio-select';
import {Field,Notice} from './primitives';
import {localCandidates,localMinute} from '../../api/src/local-calendar';
import type {Design} from './creative-editor';
import './canvas-post-actions.css';

/** A calendar post that carries a version of this creative (from the creative read). */
export type CreativeSlot={id:string;plan_id:string;state:string;revision:number;channel:string;planned_at:string;format:string;creative_version_id:string;creative_sha256:string;timezone:string;plan_title:string};
export type CreativeVariant={id:string;latest_version_id:string|null;archived_at:string|null;archive_revision:number;media_id:string|null;version_status:string|null;review_revision:number|null;job_status:string|null};
export type BrandStyle={colors:string[];typography:{headline:{family:string;weight:number};body:{family:string;weight:number}}|null};
export type PostVersion={id:string;sha256:string;design:Design;caption:string;status:string;review_revision:number;skill_manifest:{creative_spec?:CreativeSpec|null}|null};
type CreativeSpec={placement:string;aspect:string;slide_count:number|null;artwork?:unknown};
type Business={id:string;role:string};
type Plan={id:string;title:string;starts_on:string;timezone:string;duration_days:number};
const CHANNELS=[['instagram','Instagram'],['facebook','Facebook'],['linkedin','LinkedIn']] as const;
const DAY=86400000;
const writer=(role:string)=>['owner','admin','editor'].includes(role);
const reviewer=(role:string)=>['owner','admin'].includes(role);

/** The post format a saved image fits: its own saved placement, else the shape of its pixels. */
export function postSpec(version:PostVersion):CreativeSpec{
 const saved=version.skill_manifest?.creative_spec;
 if(saved?.placement&&saved.aspect)return {placement:saved.placement,aspect:saved.aspect,slide_count:null,...(saved.artwork?{artwork:saved.artwork}:{})};
 const {width,height}=version.design,ratio=height/width;
 return ratio>=1.7?{placement:'story',aspect:'vertical',slide_count:null}:ratio>1.05?{placement:'feed',aspect:'portrait',slide_count:null}:ratio<0.95?{placement:'feed',aspect:'landscape',slide_count:null}:{placement:'feed',aspect:'square',slide_count:null};
}
const addDays=(day:string,days:number)=>new Date(Date.parse(day+'T00:00:00Z')+days*DAY).toISOString().slice(0,10);
const slotStatus=(state:string):Status=>state==='approved'?'approved':state==='pending_review'?'in_review':state==='changes_requested'||state==='rejected'?'needs_attention':'draft_ready';
const versionStatus=(state:string):Status=>state==='approved'?'approved':state==='in_review'?'in_review':['changes_requested','rejected'].includes(state)?'needs_attention':'draft_ready';
export function slotWhen(slot:CreativeSlot):string{
 const local=localMinute(slot.planned_at,slot.timezone);
 const day=new Date(local.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
 return `${day}, ${local.slice(11)} (${slot.timezone})`;
}
const slotItem=(slot:CreativeSlot)=>({id:slot.id,revision:slot.revision,creative_version_id:slot.creative_version_id,creative_sha256:slot.creative_sha256});

/** After a new saved version, calendar posts that held an earlier version of this creative move to it.
 * An approved post needs approval again; nothing is published. Returns the number of posts updated. */
/** Moves calendar posts onto a new creative version. Saving moves only posts that are not yet approved; an approved
 * post keeps its approved version until the owner explicitly moves it (`resetApproval`), which sends it back to review. */
export async function syncCalendarPosts(businessId:string,slots:readonly CreativeSlot[],versionId:string,{resetApproval=false}:{resetApproval?:boolean}={}):Promise<number>{
 const stale=slots.filter(slot=>slot.creative_version_id!==versionId&&slot.state!=='cancelled'&&(resetApproval||slot.state!=='approved'));
 for(const slot of stale)await api(`/api/v1/businesses/${businessId}/content-slots/${slot.id}`,{revision:slot.revision,creative_version_id:versionId,...(slot.state==='approved'?{reset_approval:true}:{})},'PATCH');
 return stale.length;
}

/** Approve, schedule, vary and regenerate one creative from the Create canvas. Every decision goes through
 * the same endpoints as the calendar, so the calendar shows exactly what was decided here. */
export function CanvasPostActions({business,projectId,threadId,version,latest,slots,variants,dirty,busy,onBusy,onReload,onAsk,timezone,defaultChannel}:{
 business:Business;projectId:string;threadId:string;version:PostVersion;latest:boolean;slots:CreativeSlot[];variants:CreativeVariant[];dirty:boolean;busy:boolean;
 onBusy:(busy:boolean)=>void;onReload:(notice:string)=>Promise<void>;onAsk?:(message:string)=>void;timezone:string;defaultChannel:string;
}){
 const root=`/api/v1/businesses/${business.id}`;
 const [panel,setPanel]=useState<''|'calendar'|'regenerate'>(''),[error,setError]=useState<unknown>();
 const slot=slots.find(s=>s.creative_version_id===version.id)??slots[0];
 const onCalendar=!!slot&&slot.creative_version_id===version.id;
 const approved=onCalendar?slot.state==='approved':version.status==='approved';
 const blocked=busy||dirty||!latest;
 const run=async(action:()=>Promise<string>)=>{onBusy(true);setError(undefined);try{const notice=await action();await onReload(notice);setPanel('');}catch(e){setError(e);}finally{onBusy(false);}};
 async function approve():Promise<string>{
  if(onCalendar){
   if(['draft_ready','changes_requested'].includes(slot.state))await api(root+'/reviews/bulk-submit',{items:[slotItem(slot)]});
   if(!reviewer(business.role))return 'Sent for approval. An owner or admin approves it in the calendar.';
   const fresh=(await api<{slot:{revision:number}}>(`${root}/content-slots/${slot.id}`)).slot;
   await api(root+'/reviews/bulk-approve',{confirmed:true,items:[{...slotItem(slot),revision:fresh.revision}]});
   return 'Approved. The calendar post is approved; nothing has been published.';
  }
  let revision=version.review_revision;
  if(['draft','changes_requested'].includes(version.status)){revision=(await api<{revision:number}>(`${root}/creative-versions/${version.id}/review`,{decision:'in_review',feedback:'',revision})).revision;}
  if(!reviewer(business.role))return 'Sent for review. An owner or admin approves it.';
  await api(`${root}/creative-versions/${version.id}/review`,{decision:'approved',feedback:'',revision});
  return 'Approved. This version has not been scheduled or published.';
 }
 return <section className="canvas-post-actions" aria-label="Post actions">
  <div className="canvas-post-status">
   <StatusBadge status={onCalendar?slotStatus(slot.state):versionStatus(version.status)}/>
   {slot&&<span className="canvas-post-when">{onCalendar?'On calendar':'Calendar has an earlier version'} · {slotWhen(slot)} · {CHANNELS.find(c=>c[0]===slot.channel)?.[1]??slot.channel}</span>}
   {slot&&<a className="canvas-post-link" href={`/b/${business.id}/content-plan?plan=${slot.plan_id}&slot=${slot.id}`}>Open in calendar</a>}
  </div>
  <Notice error={error}/>
  {writer(business.role)&&<div className="canvas-post-buttons" role="group" aria-label="Approve and schedule">
   {!approved&&<Button variant="primary" size="sm" disabled={blocked} onClick={()=>void run(approve)} label={onCalendar?'Approve post':reviewer(business.role)?'Approve':'Send for review'}/>}
   {!onCalendar&&<Button size="sm" disabled={blocked} aria-expanded={panel==='calendar'} onClick={()=>setPanel(p=>p==='calendar'?'':'calendar')} label={slot?'Move calendar post to this version':'Add to calendar'}/>}
   {variants.length<=1&&<Button size="sm" disabled={blocked} onClick={()=>void run(async()=>{await api(`${root}/canvas/threads/${threadId}/messages`,{variant_of:projectId,variant_count:2},'POST',crypto.randomUUID());return 'Creating two alternatives from the same brief.';})} label="Make 2 alternatives"/>}
   {onAsk&&<Button size="sm" variant="quiet" disabled={blocked} aria-expanded={panel==='regenerate'} onClick={()=>setPanel(p=>p==='regenerate'?'':'regenerate')} label="Regenerate"/>}
  </div>}
  {panel==='calendar'&&(slot?<MoveToVersion businessId={business.id} slots={slots} versionId={version.id} disabled={blocked} onDone={()=>void run(async()=>'Calendar post updated to this version.')} onError={setError}/>:<CalendarForm root={root} version={version} timezone={timezone} defaultChannel={defaultChannel} disabled={blocked} onSaved={when=>run(async()=>`Added to your calendar for ${when}.`)}/>)}
  {panel==='regenerate'&&onAsk&&<RegenerateForm disabled={blocked} onAsk={message=>{setPanel('');onAsk(message);}}/>}
  {variants.length>1&&<Alternatives business={business} projectId={projectId} variants={variants} design={version.design} disabled={busy||dirty} run={run}/>}
 </section>;
}

function MoveToVersion({businessId,slots,versionId,disabled,onDone,onError}:{businessId:string;slots:CreativeSlot[];versionId:string;disabled:boolean;onDone:()=>void;onError:(e:unknown)=>void}){
 return <div className="canvas-post-panel"><p>Your calendar post uses an earlier version of this image. Moving it to this version needs a new approval.</p><Button size="sm" variant="primary" disabled={disabled} onClick={()=>void syncCalendarPosts(businessId,slots,versionId,{resetApproval:true}).then(onDone,onError)} label="Use this version on the calendar"/></div>;
}

/** Date, time and channel in the business time zone. Uses a plan that covers the day, else starts one. */
function CalendarForm({root,version,timezone,defaultChannel,disabled,onSaved}:{root:string;version:PostVersion;timezone:string;defaultChannel:string;disabled:boolean;onSaved:(when:string)=>Promise<void>}){
 const spec=postSpec(version),story=spec.placement==='story';
 const tomorrow=localMinute(Date.now()+DAY,timezone).slice(0,10);
 const [day,setDay]=useState(tomorrow),[time,setTime]=useState('09:00'),[channel,setChannel]=useState(story&&defaultChannel==='linkedin'?'instagram':CHANNELS.some(c=>c[0]===defaultChannel)?defaultChannel:'instagram'),[error,setError]=useState<unknown>(),[saving,setSaving]=useState(false);
 const key=useRef(crypto.randomUUID()),formId=useId();
 useEffect(()=>{key.current=crypto.randomUUID();},[day,time,channel]);
 async function submit(event:FormEvent){
  event.preventDefault();setError(undefined);
  const candidates=localCandidates(`${day}T${time}`,timezone);
  if(candidates.length!==1){setError(new Error('Choose a time that exists once in '+timezone+' (not inside a daylight-saving change).'));return;}
  if(Date.parse(candidates[0])<Date.now()){setError(new Error('Choose a time in the future.'));return;}
  setSaving(true);
  try{
   const brief=(version.caption||'Post created in Create').slice(0,2000);
   const plans=(await api<{plans:Plan[]}>(root+'/content-plans')).plans;
   const plan=plans.find(p=>p.timezone===timezone&&day>=p.starts_on&&day<addDays(p.starts_on,p.duration_days));
   if(plan){
    const added=await api<{id:string}>(`${root}/content-plans/${plan.id}/posts`,{format:'static',brief,channel,planned_at:candidates[0],creative_spec:spec},'POST',key.current);
    const fresh=(await api<{slot:{revision:number}}>(`${root}/content-slots/${added.id}`)).slot;
    await api(`${root}/content-slots/${added.id}`,{revision:fresh.revision,creative_version_id:version.id},'PATCH');
   }else{
    const month=new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
    await api(root+'/content-plans',{title:`Created in Create · ${month}`,objective:'Posts made and scheduled from Create',starts_on:day,timezone,slots:[{channel,planned_at:candidates[0],format:'static',brief,creative_version_id:version.id,creative_spec:spec}]},'POST',key.current);
   }
   await onSaved(`${day} at ${time} (${timezone})`);
  }catch(e){setError(e);}finally{setSaving(false);}
 }
 return <form className="canvas-post-panel" aria-label="Add to calendar" onSubmit={e=>void submit(e)}>
  <div className="canvas-post-fields">
   <Field label="Channel">{id=><DesvioSelect id={id} value={channel} onChange={e=>setChannel(e.target.value)}>{CHANNELS.filter(([value])=>!(story&&value==='linkedin')).map(([value,name])=><option key={value} value={value}>{name}</option>)}</DesvioSelect>}</Field>
   <Field label="Date">{id=><input id={id} type="date" required min={localMinute(Date.now(),timezone).slice(0,10)} value={day} onChange={e=>setDay(e.target.value)}/>}</Field>
   <Field label={`Time (${timezone})`}>{id=><input id={id} type="time" required step={300} value={time} onChange={e=>setTime(e.target.value)}/>}</Field>
  </div>
  <Notice error={error}/>
  <p className="canvas-post-hint" id={formId}>Adds a draft post with this exact image. You approve it before anything is published.</p>
  <Button type="submit" variant="primary" size="sm" loading={saving} disabled={disabled||saving||!day||!time} aria-describedby={formId} label="Add to calendar"/>
 </form>;
}

function RegenerateForm({disabled,onAsk}:{disabled:boolean;onAsk:(message:string)=>void}){
 const [headline,setHeadline]=useState(''),[feedback,setFeedback]=useState('');
 return <div className="canvas-post-panel canvas-post-regenerate">
  <form onSubmit={e=>{e.preventDefault();if(headline.trim())onAsk(`Regenerate this image with the new headline: "${headline.trim()}". Keep the layout, brand and format.`);}}>
   <Field label="New headline">{id=><input id={id} maxLength={120} value={headline} onChange={e=>setHeadline(e.target.value)} placeholder="Fresh from the oven at 7am"/>}</Field>
   <Button type="submit" size="sm" disabled={disabled||!headline.trim()} label="Regenerate with new headline"/>
  </form>
  <form onSubmit={e=>{e.preventDefault();if(feedback.trim())onAsk(`Revise the current image: ${feedback.trim()}`);}}>
   <Field label="What should change?">{id=><textarea id={id} rows={2} maxLength={1500} value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Warmer light, show the bun closer"/>}</Field>
   <Button type="submit" size="sm" disabled={disabled||!feedback.trim()} label="Regenerate with feedback"/>
  </form>
 </div>;
}

/** Compare alternatives and keep one. The others are archived (restorable) and, for a reviewer, recorded as
 * not chosen, so the business's preferences learn from the pick. */
function Alternatives({business,projectId,variants,design,disabled,run}:{business:Business;projectId:string;variants:CreativeVariant[];design:Design;disabled:boolean;run:(action:()=>Promise<string>)=>Promise<void>}){
 const root=`/api/v1/businesses/${business.id}`,live=variants.filter(v=>!v.archived_at),pending=live.some(v=>['queued','running','retrying'].includes(v.job_status??''));
 if(live.length<=1)return null;
 async function keep(chosen:CreativeVariant):Promise<string>{
  for(const other of live.filter(v=>v.id!==chosen.id)){
   if(reviewer(business.role)&&other.latest_version_id&&other.version_status&&['draft','changes_requested','in_review'].includes(other.version_status)&&other.review_revision!==null){
    let revision=other.review_revision;
    if(other.version_status!=='in_review')revision=(await api<{revision:number}>(`${root}/creative-versions/${other.latest_version_id}/review`,{decision:'in_review',feedback:'',revision})).revision;
    await api(`${root}/creative-versions/${other.latest_version_id}/review`,{decision:'rejected',feedback:'Another alternative was chosen.',revision});
   }
   await api(`${root}/creative-projects/${other.id}/archive`,{revision:other.archive_revision});
  }
  return 'Kept your chosen alternative. The others are archived and can be restored.';
 }
 return <section className="canvas-alternatives" aria-label="Alternatives">
  <header><h3>Alternatives</h3><span>{pending?'Creating alternatives…':'Keep the one you like best.'}</span></header>
  <ol>{live.map((variant,i)=><li key={variant.id} aria-current={variant.id===projectId?'true':undefined}>
   <MediaImage businessId={business.id} source={variant.media_id?{kind:'creative',id:variant.media_id}:null} width={design.width} height={design.height} alt={`Alternative ${i+1}`} sizes="160px" emptyLabel={['failed','rejected','canceled','unknown'].includes(variant.job_status??'')?'Could not create':'Creating…'}/>
   <span className="canvas-alternative-label">{i===0?'Original':`Alternative ${i}`}{variant.id===projectId?' · on canvas':''}</span>
   {writer(business.role)&&<Button size="sm" variant={variant.id===projectId?'primary':'secondary'} disabled={disabled||pending||!variant.latest_version_id} onClick={()=>void run(()=>keep(variant))} label={`Keep ${i===0?'the original':`alternative ${i}`}`}/>}
  </li>)}</ol>
 </section>;
}
