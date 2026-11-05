"use client";
import {useEffect,useRef,useState} from 'react';
import './generation-progress.css';
type Timing={min_seconds:number;max_seconds:number;sample_count?:number};
type Run={id:string;status:string;created_at?:string;cancel_requested?:boolean;awaiting_approval?:boolean;provider_progress?:number|null};
export function GenerationProgress({media,run,stage=0,timing,disconnected=false}:{media:'image'|'video';run:Run;stage?:number;timing?:Timing|null;disconnected?:boolean}){
 const ref=useRef<HTMLElement>(null),[now,setNow]=useState(()=>Date.now()),[onScreen,setOnScreen]=useState(true),[documentVisible,setDocumentVisible]=useState(true);
 const active=['queued','running','retrying'].includes(run.status)&&!run.cancel_requested&&!run.awaiting_approval&&!disconnected;
 const moving=active&&onScreen&&documentVisible;
 useEffect(()=>{const update=()=>{setDocumentVisible(!document.hidden);setNow(Date.now());};update();document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>setOnScreen(entry.isIntersecting));if(ref.current)observer.observe(ref.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!moving)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[moving,run.id]);
 const start=Date.parse(run.created_at??''),elapsed=Number.isFinite(start)?Math.max(0,Math.floor((now-start)/1000)):null;
 const estimate=timing&&Number.isFinite(timing.min_seconds)&&Number.isFinite(timing.max_seconds)&&timing.min_seconds>0&&timing.max_seconds>=timing.min_seconds?timing:null;
 const over=elapsed!==null&&!!estimate&&elapsed>estimate.max_seconds;
 const labels=media==='video'?['Preparing your video','Generating your video','Saving to your canvas']:['Preparing your image','Generating your image','Saving to your canvas'];
 const step=Math.max(0,Math.min(stage,2));
 const title=disconnected?'Reconnecting to progress':run.cancel_requested?'Canceling your request':run.awaiting_approval?'Ready for your review':run.status==='unknown'?'Checking generation status':run.status==='succeeded'?`Your ${media} is ready`:!active?'Generation stopped':labels[step];
 const pct=media==='video'&&step===1&&typeof run.provider_progress==='number'&&Number.isFinite(run.provider_progress)&&run.provider_progress>=0&&run.provider_progress<=1?Math.round(run.provider_progress*100):null;
 const clock=(seconds:number)=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
 const time=(seconds:number)=>new Date(start+seconds*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const minutes=(seconds:number)=>Math.max(1,Math.ceil(seconds/60));
 return <section ref={ref} className={`generation-progress ${moving?'is-animating':''}`} aria-label={`${media==='video'?'Video':'Image'} generation progress`}>
  <div className="generation-progress-heading"><span className="generation-live-dot" aria-hidden="true"/><strong role="status">{title}</strong>{elapsed!==null&&<span className="generation-elapsed">{clock(elapsed)} elapsed</span>}</div>
  <div className="generation-progress-track" role="progressbar" aria-label={title} aria-valuemin={pct!==null?0:undefined} aria-valuemax={pct!==null?100:undefined} aria-valuenow={pct??undefined}>
   {pct!==null&&<span className="generation-reported" style={{transform:`scaleX(${pct/100})`}}/>}<span className="generation-sweep" aria-hidden="true"/>
  </div>
  <ol className="generation-stages" aria-label="Generation stages">{['Prepare','Generate','Save'].map((label,i)=><li key={label} className={i===step?'current':i<step?'complete':''} aria-current={active&&i===step?'step':undefined}>{label}</li>)}</ol>
  {active&&<p className="generation-estimate">{over?'Taking longer than estimated. We’re still checking for your result.':estimate?Number.isFinite(start)?<>Estimated ready <strong>{time(estimate.min_seconds)} to {time(estimate.max_seconds)}</strong></>:<>Estimated time <strong>{minutes(estimate.min_seconds)} to {minutes(estimate.max_seconds)} minutes</strong></>:'Estimating the wait. We’ll show a time range once enough completed jobs are available.'}</p>}
  {active&&<p className="generation-progress-note">{pct!==null?`${pct}% rendered. `:''}{estimate?'Estimate based on recent completed '+media+' jobs. ':''}The moving line shows activity, not a countdown. You can return through History.</p>}
  {disconnected&&<p className="generation-progress-note">Your saved request is still available. Live updates will resume when the connection returns.</p>}
  {!disconnected&&run.status==='unknown'&&<p className="generation-progress-note">We’re checking the provider’s response. No duplicate request will be sent automatically.</p>}
 </section>;
}
