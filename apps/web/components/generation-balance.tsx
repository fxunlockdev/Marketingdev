"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
type Balance={configured:false}|{configured:true;enabled:boolean;total_credits:number;used_credits:number;remaining_credits:number;resets_at:string};
export function GenerationBalance({organizationId}:{organizationId:string}){
 const [data,setData]=useState<Balance>(),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true,sequence=0;setData(undefined);setFailed(false);
  async function refresh(){const current=++sequence;try{const result=await api<Balance>(`/api/v1/workspaces/${organizationId}/generation-usage`);if(active&&current===sequence){setData(result);setFailed(false);}}catch{if(active&&current===sequence){setData(undefined);setFailed(true);}}}
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  void refresh();const timer=setInterval(visible,60000);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
 },[organizationId,revision]);
 if(failed)return <button className="quiet" onClick={()=>setRevision(v=>v+1)}>Retry credit balance</button>;
 if(!data?.configured)return null;
 return <details className="generation-balance"><summary>{data.enabled?`${data.remaining_credits.toLocaleString()} credits`:'Generation paused'}</summary><div className="generation-balance-detail"><strong>{data.used_credits.toLocaleString()} of {data.total_credits.toLocaleString()} credits used</strong><p>Shared across your businesses. Includes work in progress.</p><p>Resets {new Date(data.resets_at).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'})} at 00:00 UTC.</p>{!data.enabled&&<p>Your plan is paused. Contact support to resume generation.</p>}<button onClick={()=>setRevision(v=>v+1)}>Refresh balance</button></div></details>;
}
