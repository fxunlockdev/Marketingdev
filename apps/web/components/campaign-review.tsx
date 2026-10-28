"use client";
import {useCallback,useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {api,ApiError} from './api';
import {AppLink} from './app-link';
import {Loading,Notice} from './primitives';
import {CampaignBlogsList} from './campaign-blog';
import {CampaignNewPost} from './campaign-new-post';
import {CampaignMediaPreview} from './campaign-media-preview';
import {postFormatLabel} from './post-format';
import {PostThumbnail} from './post-thumbnail';
import {PlannedTopic} from './planned-topic';
import {CampaignImages} from './campaign-images';
import {campaignPostProgress} from './campaign-post-progress';
import {SavedReferencePreviews} from './brand-references';
import {creativeDimensions} from '../../api/src/campaign-formats';
import {addDays,dayStart} from '../../api/src/local-calendar';

/** Campaign creation returns here, independently of the conversational workspace. */
export function CampaignReview({business}:{business:{id:string;name:string;role:string}}){
 const router=useRouter(),query=useSearchParams(),planId=query.get('plan'),thread=query.get('thread');
 const root=`/api/v1/businesses/${business.id}`;
 const [plan,setPlan]=useState<any>(),[slots,setSlots]=useState<any[]>([]),[error,setError]=useState<unknown>(),[revision,setRevision]=useState(0),[editing,setEditing]=useState<Set<string>>(new Set()),[status,setStatus]=useState('queued'),[reconnecting,setReconnecting]=useState(false),[generationStates,setGenerationStates]=useState<string[]>([]),[generationJobs,setGenerationJobs]=useState<{slot_id:string;status:string}[]>([]);
 const writable=['owner','admin','editor'].includes(business.role);
 useEffect(()=>{setPlan(undefined);setSlots([]);setEditing(new Set());setError(undefined);setStatus('queued');setGenerationStates([]);setGenerationJobs([]);},[root,planId,thread]);
 const track=useCallback((id:string,open:boolean)=>setEditing(current=>{const next=new Set(current);open?next.add(id):next.delete(id);return next;}),[]);
 useEffect(()=>{let active=true,failures=0,timer:ReturnType<typeof setTimeout>;setError(undefined);setReconnecting(false);async function load(){try{
  let selected=planId;
  if(!selected){if(!thread)throw new Error('Choose a campaign to continue.');const result=await api(root+'/content-plan/jobs');if(!active)return;setReconnecting(false);const job=result.jobs.find((j:any)=>j.thread_id===thread);if(!job)throw new Error('This campaign could not be found.');if(!active)return;setStatus(job.status);selected=job.output_plan_id;if(!selected){if(['queued','running','retrying'].includes(job.status)){failures=0;timer=setTimeout(load,2500);return;}throw new Error('Your campaign needs attention. Try loading its status again.');}}
  const saved=await api(root+'/content-plans/'+selected);if(!active)return;
  let page=1,more=false;const posts:any[]=[];
  do{const params=new URLSearchParams({plan_id:saved.id,start:dayStart(saved.starts_on,saved.timezone),end:dayStart(addDays(saved.starts_on,saved.duration_days),saved.timezone)});params.set('page',String(page));const data=await api(root+'/content-plan?'+params);if(!active)return;posts.push(...data.slots);more=data.has_more;page++;}while(more&&page<=100);
  if(active){setPlan(saved);setSlots(posts);setError(undefined);setReconnecting(false);}
 }catch(e){if(!active)return;
  // Retry only reads: reconnecting must never submit another paid generation.
  if(e instanceof ApiError&&(e.status===0||e.status===429||e.status>=500)&&failures<4){
   setReconnecting(true);timer=setTimeout(load,Math.min(15000,2000*2**failures++));
  }else{setReconnecting(false);setError(e);}
 }}void load();return()=>{active=false;clearTimeout(timer);};},[root,planId,thread,revision]);
 const ready=slots.filter(s=>s.creative_version_id||s.video_version_id||s.carousel_version_id).length;
 return <section className="campaign-review-screen"><AppLink href={`/b/${business.id}/campaigns`}>← Campaigns</AppLink><Notice error={error}/>{reconnecting&&<p role="status">Reconnecting… Your campaign is saved. We’ll check again automatically.</p>}{error!==undefined&&<button onClick={()=>setRevision(n=>n+1)}>Try again</button>}
 {!plan&&!error?<section className="campaign-wait" role="status"><Loading/><h1>{status==='queued'?'Preparing your campaign':'Finding the right topics'}</h1><p>Your posts will appear here as soon as the plan is ready.</p><div className="planning-outline" aria-hidden="true">{[1,2,3].map(n=><span key={n}><span className="planning-outline-image"/><span className="planning-outline-line"/></span>)}</div></section>:plan&&<>
 <header className="campaign-review-heading"><div><p className="eyebrow">{business.name} · {slots.length} posts</p><h1>{slots.length>0&&ready===slots.length?'Your content is ready':ready?'Your campaign':generationStates.some(s=>['failed','rejected','unknown','canceled','review_changed','needs_attachment'].includes(s))?'Some posts need attention':(query.get('stage')==='generating'||generationStates.length>0)?(slots.length>0&&slots.every(s=>s.format==='video')?'Review your video scripts':'Creating your posts'):'Review your topics'}</h1><p>{plan.title}</p></div><div className="campaign-review-actions"><CampaignNewPost businessId={business.id} initialPlan={plan.id}/><AppLink className="button" href={`/b/${business.id}/content-plan?start=${plan.starts_on}&plan=${plan.id}`}>View calendar</AppLink></div></header>
 
 <ol className="campaign-preview-grid" aria-label="Campaign posts">{slots.map(s=>{const progress=campaignPostProgress(generationJobs.find(j=>j.slot_id===s.id)?.status);return <li key={s.id}>
 <div className="campaign-card-top"><span>{postFormatLabel(s)}</span><time dateTime={s.planned_at}>{new Intl.DateTimeFormat(undefined,{timeZone:plan.timezone,month:'short',day:'numeric'}).format(new Date(s.planned_at))}</time></div>
 <div className="campaign-card-image" style={s.creative_spec?{aspectRatio:`${creativeDimensions(s.creative_spec).width} / ${creativeDimensions(s.creative_spec).height}`}:{}}>{!s.creative_version_id&&!s.video_version_id&&!s.carousel_version_id&&s.reference_ids?.length?<><SavedReferencePreviews businessId={business.id} ids={s.reference_ids.slice(0,1)}/><span className="reference-preview-label">Reference image</span></>:!s.creative_version_id&&!s.video_version_id&&!s.carousel_version_id&&progress?<div className={`campaign-generation-placeholder ${progress.tone}`} role="status"><strong>{progress.label}</strong><p>{progress.description}</p></div>:<PostThumbnail businessId={business.id} post={s}/>}</div>
 <div className="campaign-card-body">{progress&&<div className={`campaign-post-progress ${progress.tone}`}><strong>{progress.label}</strong>{progress.recover&&<AppLink className="button" href={`/b/${business.id}/campaign-post?slot=${s.id}`}>Open post to resolve</AppLink>}</div>}<CampaignMediaPreview business={business} post={s}/><PlannedTopic showReferencePreview={false} businessId={business.id} slot={s} writable={writable} onEditing={track} onSaved={updated=>setSlots(current=>current.map(item=>item.id===updated.id?{...item,...updated}:item))}/>{!s.video_version_id&&s.format==='video'&&<AppLink className="button" href={`/b/${business.id}/campaign-post?slot=${s.id}`}>Review script and framing</AppLink>}{(s.creative_version_id||s.video_version_id||s.carousel_version_id)&&<AppLink className="button primary" href={`/b/${business.id}/campaign-post?slot=${s.id}`}>Review post</AppLink>}</div>
 </li>;})}</ol>
 <CampaignBlogsList businessId={business.id} planId={plan.id}/>
 <footer className="campaign-review-footer"><CampaignImages automatic reviewed onStates={setGenerationStates} onJobs={setGenerationJobs} businessId={business.id} planId={plan.id} slots={slots} disabled={!writable||editing.size>0} onRefresh={()=>setRevision(n=>n+1)} onStarted={()=>{router.replace(`/b/${business.id}/campaign-review?plan=${plan.id}&stage=generating`);setRevision(n=>n+1);window.scrollTo({top:0,behavior:'auto'});}}/></footer>
 
 </>}
 </section>;
}
