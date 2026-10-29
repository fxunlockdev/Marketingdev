"use client";
import {useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {GenerationNotification} from './generation-notification';
import {Notice} from './primitives';
type Request={key:string;body:{slots:{id:string;revision:number}[];credit_cap?:number;automatic?:boolean}};
export function CampaignImages({businessId,planId,slots,disabled,onRefresh,compact=false,reviewed=false,automatic=false,onStarted,onStates,onJobs}:{businessId:string;planId:string;slots:any[];disabled:boolean;onRefresh:()=>void;compact?:boolean;reviewed?:boolean;automatic?:boolean;onStarted?:()=>void;onStates?:(states:string[])=>void;onJobs?:(jobs:{slot_id:string;status:string}[])=>void}){
 const root=`/api/v1/businesses/${businessId}/content-plans/${planId}`;
 const refreshCallback=useRef(onRefresh);refreshCallback.current=onRefresh;
 const stateCallback=useRef(onStates);stateCallback.current=onStates;
 const jobsCallback=useRef(onJobs);jobsCallback.current=onJobs;
 const observed=useRef<string|undefined>(undefined);
 const storageKey=`campaign-images:${businessId}:${planId}`;
 const request=useRef<Request|undefined>(undefined),sending=useRef(false),autoAttempt=useRef('');
 const [pending,setPending]=useState(false),[busy,setBusy]=useState(false),[jobs,setJobs]=useState<any[]>([]),[error,setError]=useState<unknown>(),[refresh,setRefresh]=useState(0),[loaded,setLoaded]=useState(false),[quantity,setQuantity]=useState<number|undefined>(),[creditCap,setCreditCap]=useState<number|undefined>(),[quote,setQuote]=useState<{available:boolean;slots:{id:string;revision:number;credits:number}[]}>();
 useEffect(()=>{
  request.current=undefined;observed.current=undefined;setPending(false);setJobs([]);setLoaded(false);setError(undefined);setQuantity(undefined);setCreditCap(undefined);setQuote(undefined);
  try{const saved=sessionStorage.getItem(storageKey);if(saved){request.current=JSON.parse(saved);setPending(true);}}
  catch{setError(new Error('Your saved request could not be read. Refresh before generating.'));}
 },[storageKey]);
 useEffect(()=>{
  let mounted=true,timer:ReturnType<typeof setTimeout>,failures=0;
  async function load(){
   try{
    const result=await api(root+'/image-batch');if(!mounted)return;
    failures=0;setJobs(result.jobs);stateCallback.current?.(result.jobs.map((j:any)=>j.status));jobsCallback.current?.(result.jobs);setQuote(result.quote);setLoaded(true);
    const signature=JSON.stringify(result.jobs.map((j:any)=>[j.id,j.status]));
    if(observed.current!==undefined&&observed.current!==signature)refreshCallback.current();
    observed.current=signature;
    if(request.current?.key===result.request_key){request.current=undefined;sessionStorage.removeItem(storageKey);setPending(false);}
    if(result.jobs.some((j:any)=>['queued','running','retrying','awaiting_approval'].includes(j.status)))timer=setTimeout(load,result.jobs.every((j:any)=>j.status==='awaiting_approval')?10000:4000);
   }catch(e){
    if(!mounted)return;
    setError(e);setLoaded(false);
    // Retry reads only. Never resubmit a potentially paid request automatically.
    if(!(e instanceof ApiError&&[400,401,403,404].includes(e.status))){
     failures++;timer=setTimeout(load,Math.min(15000,2000*2**Math.min(failures-1,3)));
    }
   }
  }
  void load();return()=>{mounted=false;clearTimeout(timer);};
 },[root,storageKey,refresh,slots.map(s=>`${s.id}:${s.revision}`).join(',')]);
 const eligible=slots.filter(s=>(automatic?['static','carousel'].includes(s.format):reviewed?['static','carousel','video'].includes(s.format):s.format==='static')&&s.state==='content_needed'&&!s.creative_version_id&&!s.video_version_id&&!s.carousel_version_id&&!jobs.some(j=>j.slot_id===s.id));
 const count=Math.min(quantity??eligible.length,eligible.length);
 const selectedQuotes=eligible.slice(0,count).map(s=>quote?.slots.find(q=>q.id===s.id&&q.revision===s.revision));
 const quoteReady=!!quote?.available&&count>0&&selectedQuotes.every(Boolean);
 const minimum=quoteReady?Math.max(1,selectedQuotes.reduce((sum,q)=>sum+q!.credits,0)):0;
 const cap=Math.max(creditCap??minimum,minimum);
 const active=jobs.some(j=>['queued','running','retrying','unknown'].includes(j.status));
 async function generate(auto=false){if(sending.current)return;sending.current=true;setBusy(true);setError(undefined);try{
  if(!request.current){const selected=eligible.slice(0,count).map(s=>({id:s.id,revision:s.revision})).sort((a,b)=>a.id.localeCompare(b.id));const digest=auto?[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({planId,slots:selected}))))].map(n=>n.toString(16).padStart(2,'0')).join(''):'';request.current={key:auto?`auto-campaign:${digest}`:crypto.randomUUID(),body:{slots:selected,...(reviewed||auto?{credit_cap:cap}:{}),...(auto?{automatic:true}:{})}};}sessionStorage.setItem(storageKey,JSON.stringify(request.current));setPending(true);
  const result=await api(root+'/generate-images',request.current.body,'POST',request.current.key);setJobs(result.jobs);sessionStorage.removeItem(storageKey);request.current=undefined;setPending(false);setRefresh(n=>n+1);onStarted?.();
 }catch(e){setError(e);if(e instanceof ApiError&&[400,401,403,404,409,422,429].includes(e.status)){sessionStorage.removeItem(storageKey);request.current=undefined;setPending(false);setRefresh(n=>n+1);}}finally{sending.current=false;setBusy(false);}}
 const autoSignature=eligible.map(s=>`${s.id}:${s.revision}`).sort().join(',');
 useEffect(()=>{if(!automatic||disabled||!loaded||busy||pending||active||error!==undefined||!quoteReady||!autoSignature||autoAttempt.current===autoSignature)return;autoAttempt.current=autoSignature;void generate(true);},[automatic,disabled,loaded,busy,pending,active,error,quoteReady,autoSignature]);
 return <section className={`campaign-image-generation ${compact?'compact':''}`}  aria-label="Create campaign images"><h3>{automatic&&eligible.length&&!error?'Creating your campaign images':active?'Creating your posts':jobs.length?'Your campaign':reviewed?'Ready to create?':compact?'Create this post’s image':'Generate your campaign images'}</h3><Notice error={error}/>{!jobs.length&&!pending&&<p className="hint">{automatic?"Your missing images are created automatically using your available credits. Videos keep their script approval step.":compact?"Your topic is saved. Generate the finished design here using your credits.":reviewed?"Create your images and carousels together. Videos keep their script and reference approval step.":"Review the topics below, then generate your selected images using your credits."}</p>}
 {!!jobs.length&&<p role="status">{jobs.filter(j=>j.status==='succeeded').length} of {jobs.length} posts ready{jobs.some(j=>['queued','running','retrying'].includes(j.status))?' · Generation in progress':''}{jobs.some(j=>['failed','rejected','unknown','canceled','review_changed','needs_attachment'].includes(j.status))?' · Some posts need attention. Open them in the calendar for details.':''}</p>}
 {!disabled&&jobs.some(j=>['queued','running','retrying'].includes(j.status))&&<GenerationNotification businessId={businessId} planId={planId} jobIds={jobs.filter(j=>!['awaiting_approval','review_changed'].includes(j.status)).map(j=>j.id)}/>}
 {pending&&<p role="status">Your request is saved. Check it again to confirm whether generation started.</p>}
 {jobs.some(j=>j.status==='awaiting_approval')&&<p role="status">Your video posts are waiting for script and reference approval. Open each video to continue; video generation has not started.</p>}
 <div className="actions">{!automatic&&eligible.length>1&&!pending&&<label>Posts to create<select aria-label="Posts to create" value={count} disabled={disabled||busy||active} onChange={e=>setQuantity(Number(e.target.value))}>{Array.from({length:eligible.length},(_,i)=><option key={i+1} value={i+1}>{i+1} post{i?'s':''}</option>)}</select></label>}{!automatic&&reviewed&&!pending&&eligible.length>0&&<label>Generation credit cap<input aria-label="Generation credit cap" type="number" min={Math.max(1,minimum)} max={100000} value={cap} disabled={disabled||busy||active} onChange={e=>setCreditCap(Number(e.target.value))}/></label>}{(pending||eligible.length>0&&(!automatic||error!==undefined))&&<button type="button" className="primary" disabled={disabled||busy||(!pending&&(!loaded||active||!eligible.length||(reviewed&&(!Number.isSafeInteger(cap)||!quoteReady||cap<minimum||cap>100000))))} onClick={()=>void generate()}>{busy?'Starting generation…':pending?'Check image request':!eligible.length?'No images left to create':reviewed?`Continue · create ${count} post${count===1?'':'s'}`:`Generate ${count} image${count===1?'':'s'}`}</button>}{error!==undefined&&<button type="button" disabled={disabled||busy} onClick={()=>{setError(undefined);setRefresh(n=>n+1);onRefresh();}}>Check progress</button>}</div>
 {reviewed&&eligible.length>0&&!pending&&quoteReady&&<p className="hint">Up to {cap} credits for this step. Video generation is quoted separately after script and framing review.</p>}
 {reviewed&&loaded&&eligible.length>0&&!pending&&!quoteReady&&<p role="status">{quote?.available?'Refreshing generation capacity for your reviewed topics…':'Generation setup is unavailable. Contact your workspace administrator before continuing.'}</p>}
 {reviewed&&!pending&&eligible.length>0&&<button type="button" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Refresh credits</button>}
 {slots.some(s=>s.format==='video')&&<p className="hint">Open each video post to review its script and reference image before generation.</p>}</section>;
}
