"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {Notice} from './primitives';
export function FirstPlan({businessId,disabled,beforeSubmit}:{businessId:string;cadence:number;timezone:string;disabled:boolean;beforeSubmit:()=>Promise<boolean>}){
 const router=useRouter(),root=`/api/v1/businesses/${businessId}`,storageKey=`desvio-first-plan:${businessId}`;
 const [busy,setBusy]=useState(false),[job,setJob]=useState<any>(),[error,setError]=useState<unknown>();
 const request=useRef<{key:string;body:any;jobId?:string}|undefined>(undefined),active=useRef(false);
 useEffect(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(saved?.key&&saved?.body){request.current=saved;if(saved.jobId)setJob({id:saved.jobId,status:'queued'});}}catch{}},[storageKey]);
 useEffect(()=>{if(!job?.id)return;let alive=true,timer:ReturnType<typeof setTimeout>;let failures=0;const poll=async()=>{try{const result=await api<{jobs:Array<{id:string;status:string;output_plan_id?:string|null;error_code?:string}>}>(root+'/content-plan/jobs');if(!alive)return;const found=result.jobs.find(item=>item.id===job.id);if(!found)throw new Error('Your saved calendar request could not be found. Open Calendar to check your saved plans.');setJob(found);setError(undefined);failures=0;if(found.status==='succeeded'&&found.output_plan_id){sessionStorage.removeItem(storageKey);router.replace(`/b/${businessId}/campaign-review?plan=${encodeURIComponent(found.output_plan_id)}`);return;}if(!['queued','running','retrying'].includes(found.status)){if(found.status==='succeeded')setError(new Error('Your calendar finished without a saved plan. Open Calendar to check its status.'));return;}timer=setTimeout(poll,2500);}catch(e){if(alive){setError(e);failures++;timer=setTimeout(poll,Math.min(30000,2500*2**failures));}}};void poll();return()=>{alive=false;clearTimeout(timer);};},[job?.id,root,router,businessId,storageKey]);
 async function submit(){
  if(active.current)return;
  active.current=true;setBusy(true);setError(undefined);
  try{
   if(!await beforeSubmit())return;
   // Only reconcile a previously submitted request. New plans use the approved mood-board flow.
   if(request.current){
    const next=await api(root+'/content-plan/generate',request.current.body,'POST',request.current.key);
    request.current.jobId=next.id;sessionStorage.setItem(storageKey,JSON.stringify(request.current));setJob(next);
   }else router.push(`/b/${businessId}/guided-onboarding`);
  }catch(e){setError(e);}finally{active.current=false;setBusy(false);}
 }

 const pending=job&&['queued','running','retrying','succeeded'].includes(job.status);
 return <section className="first-plan-setup" aria-label="Your first plan">
 {pending?<div className="brand-preparing"><h2>Building your calendar</h2><p role="status">Your brand is confirmed. We’re preparing your day-by-day content plan.</p><p>You can leave and return; your request is saved.</p><Notice error={error}/>{error!==undefined&&<a href={`/b/${businessId}/content-plan`}>Open Calendar</a>}</div>:job?<div role="alert"><h3>Your calendar needs attention</h3><p>Your brand is saved. We couldn’t finish this plan. Check its status in Calendar before starting another.</p><p>{job.error_code} · {job.id}</p><a href={`/b/${businessId}/content-plan`}>Open Calendar</a></div>:<>
 <h3>Choose your creative direction</h3>
 <p>Next, review your creative direction, then choose your monthly content mix and review the calendar before generating assets.</p>
 <Notice error={error}/><button className="primary" disabled={disabled||busy} onClick={()=>void submit()}>{busy?'Saving your brand…':request.current?'Check my saved calendar request':'Continue to my creative direction'}</button>
 </>}
 </section>;
}
