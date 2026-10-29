'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
import './campaign-post-ideas.css';
type Ideas={id:string|null;status:string;ideas:{title:string;topic:string;angle:string}[]};
const pending=(status:string)=>['queued','running','retrying'].includes(status);
export function CampaignPostIdeas({businessId,planId,format,channel,onChoose}:{businessId:string;planId:string;format:string;channel:string;onChoose:(topic:string)=>void}){
 const [result,setResult]=useState<Ideas>({id:null,status:'loading',ideas:[]}),[error,setError]=useState<unknown>(),[sending,setSending]=useState(false);
 const mounted=useRef(true),requestKey=useRef(crypto.randomUUID());
 const path=`/api/v1/businesses/${businessId}/content-plans/${planId}/ideas`;
 async function generate(refresh=false){
  setSending(true);setError(undefined);
  try{const value=await api(path,{format,channel,refresh},'POST',requestKey.current);if(mounted.current)setResult(value);}
  catch(e){if(mounted.current){setError(e);setResult(v=>({...v,status:v.status==='loading'?'unavailable':v.status}));}}
  finally{if(mounted.current)setSending(false);}
 }
 useEffect(()=>{mounted.current=true;void generate();return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  if(!pending(result.status))return;
  let live=true,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const next=await api(path+`?format=${encodeURIComponent(format)}&channel=${encodeURIComponent(channel)}`);if(live){setResult(next);setError(undefined);if(pending(next.status))timer=setTimeout(poll,2500);}}catch(e){if(live){setError(e);timer=setTimeout(poll,6000);}}};
  timer=setTimeout(poll,2000);return()=>{live=false;clearTimeout(timer);};
 },[result.id,result.status,path,format,channel]);
 const working=sending||pending(result.status)||result.status==='loading',unknown=result.status==='unknown',failed=['failed','rejected','canceled'].includes(result.status);
 return <section className="campaign-post-ideas" aria-label="AI post ideas" aria-busy={working}>
  <div className="campaign-ideas-heading"><strong>Ideas for your campaign</strong><button type="button" disabled={working||unknown} onClick={()=>{if(result.status==='succeeded'||failed)requestKey.current=crypto.randomUUID();void generate(true);}}>{working?'Thinking…':result.ideas.length?'New ideas':'Try again'}</button></div>
  <small>Shaped by your brand, campaign and saved feedback.</small>
  <div role="status" aria-live="polite">{working&&'Finding fresh angles for you…'}{unknown&&'Your ideas are awaiting confirmation. We won’t submit another request while the result is uncertain.'}{failed&&'We couldn’t finish these ideas. You can try again or write your own topic.'}</div>
  <Notice error={error}/>
  {!!result.ideas.length&&<ul>{result.ideas.map((idea,i)=><li key={i}><button type="button" onClick={()=>{onChoose(idea.topic);document.getElementById('campaign-topic')?.focus();}}><span>{idea.title}</span><small>{idea.topic}</small></button></li>)}</ul>}
 </section>;
}
