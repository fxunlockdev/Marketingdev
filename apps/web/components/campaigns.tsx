"use client";
import {CampaignNewPost} from './campaign-new-post';
import {useSearchParams} from 'next/navigation';
import {CreateNew} from "./create-new";
import {useEffect,useState} from 'react';
import {api} from './api';
import {AppLink} from './app-link';
import {Loading,Notice} from './primitives';
import {PostThumbnail} from './post-thumbnail';
import {dayStart,addDays} from '../../api/src/local-calendar';
type Campaign={id:string;title:string;starts_on:string;timezone:string;duration_days:number};
export function CampaignsScreen({business}:{business:{id:string;name:string}}){
 const query=useSearchParams();
 const [plans,setPlans]=useState<Campaign[]>(),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setError(undefined);api<{plans:Campaign[]}>(`/api/v1/businesses/${business.id}/content-plans`).then(result=>{if(active)setPlans(result.plans);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[business.id,retry]);
 const groups=new Map<string,Campaign[]>();
 for(const plan of [...(plans??[])].sort((a,b)=>a.starts_on.localeCompare(b.starts_on)||a.id.localeCompare(b.id))){
  const day=new Date(plan.starts_on+'T12:00:00Z').getUTCDay(),week=addDays(plan.starts_on,-((day+6)%7));
  groups.set(week,[...(groups.get(week)??[]),plan]);
 }
 return <section className="campaigns-screen"><div className="heading-row"><div className="v5-page-title"><p className="eyebrow">{business.name}</p><h1>Campaigns</h1><p>Your saved plans, grouped by the week they start.</p></div><div className="actions"><CampaignNewPost businessId={business.id} autoOpen={query.get('post')==='new'}/><CreateNew businessId={business.id}/></div></div>
 <Notice error={error}/>{error!==undefined&&<button onClick={()=>setRetry(n=>n+1)}>Try again</button>}
 {!plans&&!error?<Loading/>:plans?.length?<div>{[...groups].map(([week,items])=><section className="overview-campaigns" key={week} aria-label={`Week of ${week}`}><h2>Week of {date(week)}</h2><ul className="overview-campaign-list">{items.map(plan=><li key={plan.id}><AppLink href={`/b/${business.id}/campaign-review?plan=${plan.id}`}><CampaignPreview businessId={business.id} plan={plan}/><div><h3>{plan.title}</h3><p>{date(plan.starts_on)} – {date(addDays(plan.starts_on,plan.duration_days-1))}</p></div><span>Open campaign</span><span aria-hidden="true">→</span></AppLink></li>)}</ul></section>)}</div>:plans&&<section className="overview-content-empty"><h2>Your first campaign starts here</h2><p>Choose what you want to promote and when. Your saved campaign will appear here.</p><AppLink href={`/b/${business.id}/campaign-new`}>Plan a campaign →</AppLink></section>}
 </section>;
}
function date(day:string){return new Intl.DateTimeFormat(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(day+'T12:00:00Z'));}

function CampaignPreview({businessId,plan}:{businessId:string;plan:Campaign}){
 const [posts,setPosts]=useState<any[]>([]);
 useEffect(()=>{let active=true;const query=new URLSearchParams({plan_id:plan.id,start:dayStart(plan.starts_on,plan.timezone),end:dayStart(addDays(plan.starts_on,plan.duration_days),plan.timezone)});api(`/api/v1/businesses/${businessId}/content-plan?${query}`).then(result=>{if(active)setPosts(result.slots.filter((p:any)=>p.design?.background_media_id||p.video_version_id||p.carousel_version_id).slice(0,3));}).catch(()=>{});return()=>{active=false;};},[businessId,plan.id,plan.starts_on,plan.duration_days,plan.timezone]);
 return <span className="campaign-preview-stack" aria-hidden="true">{posts.length?posts.map(post=><span key={post.id}><PostThumbnail businessId={businessId} post={post}/></span>):<span className="campaign-preview-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></svg></span>}</span>;
}
