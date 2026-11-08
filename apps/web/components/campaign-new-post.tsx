"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {PostArtworkChoices} from './post-artwork-choices';
import type {PostArtwork} from '../../api/src/post-artwork';
import {CampaignPostIdeas} from './campaign-post-ideas';
import {Notice} from './primitives';
import {DesvioDatePicker} from './desvio-date-picker';
import {CampaignPostReferences} from './campaign-post-references';
import {localCandidates,localMinute,addDays} from '../../api/src/local-calendar';
import './campaign-post.css';
import './campaign-redesign.css';
import './campaign-composer.css';
export const POST_FORMATS=[['static','Still image'],['carousel','Carousel Post'],['video','Feed Video Post'],['reel','Short-form Video'],['story','Story'],['blog','Blog']] as const;
export function CampaignNewPost({businessId,initialPlan,autoOpen=false}:{businessId:string;initialPlan?:string;autoOpen?:boolean}){
 const dialog=useRef<HTMLDialogElement>(null),router=useRouter(),key=useRef(crypto.randomUUID());
 const [open,setOpen]=useState(autoOpen);
 const [plans,setPlans]=useState<any[]>([]),[planId,setPlanId]=useState(initialPlan??''),[topic,setTopic]=useState(''),[context,setContext]=useState(''),[contextOpen,setContextOpen]=useState(false),[format,setFormat]=useState('static'),[channel,setChannel]=useState('instagram'),[when,setWhen]=useState(''),[references,setReferences]=useState<string[]>([]),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState<unknown>(),[slides,setSlides]=useState(4);
 const [artwork,setArtwork]=useState<PostArtwork>({text:'headline'});
 const plan=plans.find(p=>p.id===planId);
 useEffect(()=>{let live=true;api(`/api/v1/businesses/${businessId}/content-plans`).then(v=>{if(live){setPlans(v.plans);setPlanId(p=>p||v.plans[0]?.id||'');}}).catch(setError);return()=>{live=false;};},[businessId]);
 useEffect(()=>{if(!plan)return;const soon=localMinute(Date.now()+30*60*1000,plan.timezone),day=soon.slice(0,10),candidate=day<plan.starts_on?plan.starts_on+'T12:30':soon;setWhen(candidate.slice(0,10)<addDays(plan.starts_on,plan.duration_days??30)?candidate:'');},[plan?.id]);
 useEffect(()=>{if(autoOpen)dialog.current?.showModal();},[autoOpen]);
 useEffect(()=>{key.current=crypto.randomUUID();},[planId,topic,context,format,channel,when,references,slides,artwork]);
 async function save(){setBusy(true);setError(undefined);try{
  if(!plan)throw new Error('Create a campaign first.');const times=localCandidates(when,plan.timezone);if(times.length!==1)throw new Error('Choose a valid, unambiguous posting time.');
  const type=['story','reel'].includes(format)?format==='reel'?'video':'static':format;
  const body={brief:topic.trim(),context:context.trim(),planned_at:times[0],...(format==='blog'?{}:{channel,format:type,reference_ids:references,creative_spec:{placement:format==='story'?'story':format==='reel'?'reel':'feed',aspect:['story','reel'].includes(format)?'vertical':'square',slide_count:format==='carousel'?slides:null,...(['static','carousel','story'].includes(format)?{artwork}:{})}})};
  const result=await api(`/api/v1/businesses/${businessId}/content-plans/${planId}/${format==='blog'?'blogs':'posts'}`,body,'POST',key.current);
  dialog.current?.close();router.push(['static','story','carousel'].includes(format)?`/b/${businessId}/campaign-review?plan=${planId}&stage=generating`:`/b/${businessId}/campaign-post?${format==='blog'?'blog':'slot'}=${result.id}`);
 }catch(e){setError(e);}finally{setBusy(false);}}
 return <>
  <button className="primary" onClick={()=>{setOpen(true);dialog.current?.showModal();}}>＋ New Post</button>
  <dialog className="campaign-new-post" ref={dialog} aria-labelledby="new-post-heading" aria-describedby="new-post-intro" onClose={()=>setOpen(false)} onCancel={e=>{if(busy||uploading)e.preventDefault();}}>
   <header>
    <div><h2 id="new-post-heading">New Post</h2><p id="new-post-intro">Start with your topic. Make it yours with images and ideas.</p></div>
    <button type="button" aria-label="Close new post" disabled={busy||uploading} onClick={()=>dialog.current?.close()}>×</button>
   </header>
   <Notice error={error}/>
   <div className="campaign-compose-scroll"><fieldset disabled={busy||uploading} className="campaign-compose-body">
    <label className="campaign-compose-campaign">Campaign
     <select aria-label="Campaign" value={planId} onChange={e=>setPlanId(e.target.value)}>{plans.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
    </label>
    {!plans.length&&<p><a href={`/b/${businessId}/campaign-new`}>Create your first campaign</a> to start adding posts.</p>}
    <div className="campaign-compose-fields">
     <div className="heading-row"><label htmlFor="campaign-topic">Topic</label><button type="button" aria-expanded={contextOpen} aria-controls="campaign-creative-context" onClick={()=>setContextOpen(v=>!v)}>{contextOpen?'Hide context':'＋ Add context'}</button></div>
     <textarea rows={3} id="campaign-topic" placeholder="What should this post be about?" maxLength={2000} value={topic} onChange={e=>setTopic(e.target.value)}/>
     {contextOpen&&<label id="campaign-creative-context">Creative direction<textarea value={context} maxLength={1800} placeholder="Describe the scene, mood, colours or specific details…" onChange={e=>setContext(e.target.value)}/><small>Your context guides the generated creative.</small></label>}
    </div>
    {format!=='blog'&&<CampaignPostReferences businessId={businessId} selection={references} onChange={setReferences} disabled={busy} onBusy={setUploading}/>}
    {open&&planId&&<CampaignPostIdeas key={`${businessId}:${planId}:${format}:${channel}`} businessId={businessId} planId={planId} format={format} channel={channel} onChoose={setTopic}/>}
    <div className="campaign-compose-options">
     <label>Post format<select aria-label="Post format" value={format} onChange={e=>{setFormat(e.target.value);if(['story','reel'].includes(e.target.value)&&channel==='linkedin')setChannel('instagram');}}>{POST_FORMATS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     {format!=='blog'&&<label>Channel<select aria-label="Channel" value={channel} onChange={e=>setChannel(e.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option>{!['story','reel'].includes(format)&&<option value="linkedin">LinkedIn</option>}</select></label>}
     <div className="campaign-compose-schedule"><span>Posting on</span><DesvioDatePicker label="Posting on" value={when} onChange={setWhen} time timezone={plan?.timezone??'UTC'} disabled={busy||uploading}/></div>
    </div>
    <small className="campaign-compose-timezone">Times in {plan?.timezone?.replaceAll('_',' ')??'UTC'}</small>
    {plan&&!when&&<small>Choose a posting time within this campaign, or select a future campaign.</small>}
    {format==='carousel'&&<label className="campaign-compose-slides">Slides<input type="number" min={2} max={10} value={slides} onChange={e=>setSlides(Number(e.target.value))}/><small>One coordinated story across every slide.</small></label>}
    {['static','carousel','story'].includes(format)&&<details className="campaign-compose-artwork"><summary>Image text & fonts<span>{artwork.text==='none'?'No image text':artwork.typography?'Custom fonts':'Brand fonts'}</span></summary><PostArtworkChoices value={artwork} onChange={setArtwork}/></details>}
   </fieldset></div>
   <footer><span>Your post stays a draft until you approve it.</span><button className="primary" disabled={busy||uploading||!plan||!topic.trim()||!when} onClick={()=>void save()}>{busy?'Saving…':'Create Post'}</button></footer>
  </dialog>
 </>;
}
