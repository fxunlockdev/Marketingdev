"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
const names:Record<string,string>={creative_openai:'OpenAI creative planning and images',creative_gemini:'Gemini creative planning',planning_openai:'OpenAI content calendar',planning_gemini:'Gemini content calendar',video:'Video generation and editing'};
const states:Record<string,string>={missing:'Not set up',disabled:'Disabled',expired:'Expired',active:'Allowance active'};
type Allowance={capability:string;state:string;expires_at:string|null};
export function GenerationAllowances({businessId}:{businessId:string}){
 const [items,setItems]=useState<Allowance[]>(),[error,setError]=useState<unknown>(),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;setItems(undefined);setError(undefined);
  void api(`/api/v1/businesses/${businessId}/canvas/allowances`).then(result=>{if(active)setItems(result.allowances);}).catch(e=>{if(active)setError(e);});
  return()=>{active=false;};
 },[businessId,refresh]);
 return <details className="v5-panel">
  <summary>Generation allowances</summary>
  <section aria-label="Generation allowances">
   <p>These permissions belong to this business. Ask your platform administrator to configure or renew a missing allowance.</p>
   <Notice error={error}/>
   {!items&&error===undefined&&<p role="status">Loading allowances…</p>}
   {items&&<ul>{items.map(item=><li key={item.capability}>
    <strong>{names[item.capability]??item.capability}</strong>: {states[item.state]??'Unknown'}
    {item.expires_at&&<> · Expires <time dateTime={item.expires_at}>{new Date(item.expires_at).toLocaleString(undefined,{timeZone:'UTC'})} UTC</time></>}
   </li>)}</ul>}
   <p className="hint">An active allowance does not confirm AI service setup or remaining budget. Both are checked when you generate. Gemini image workflows also need the OpenAI image allowance. Video prompts and finished creatives still require approval.</p>
   <button type="button" disabled={!items&&error===undefined} onClick={()=>setRefresh(n=>n+1)}>Refresh allowances</button>
  </section>
 </details>;
}
