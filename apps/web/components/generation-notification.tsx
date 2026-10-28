"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
type Notification={id:string;status:string;job_ids:string[]};
const waiting=['waiting_generation','pending','retry','processing'];
export function GenerationNotification({businessId,planId,jobIds}:{businessId:string;planId?:string;jobIds:string[]}){
 const root=planId?`/api/v1/businesses/${businessId}/content-plans/${planId}/notifications`:`/api/v1/businesses/${businessId}/generation-notifications`,signature=[...jobIds].sort().join(',');
 const [available,setAvailable]=useState(false),[items,setItems]=useState<Notification[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[refresh,setRefresh]=useState(0),[loaded,setLoaded]=useState(false);
 useEffect(()=>{
  let current=true,timer:ReturnType<typeof setTimeout>|undefined,failures=0;
  setLoaded(false);setAvailable(false);setItems([]);setError(undefined);
  async function load(){try{
   const result=await api(root);if(!current)return;failures=0;setAvailable(result.available);setItems(result.notifications);setLoaded(true);setError(undefined);
   const matching=result.notifications.find((n:Notification)=>[...n.job_ids].sort().join(',')===signature);
   if(matching&&waiting.includes(matching.status))timer=setTimeout(load,4000);
  }catch(e){if(!current)return;setError(e);if(++failures<5)timer=setTimeout(load,Math.min(15000,2000*2**failures));}}
  void load();return()=>{current=false;if(timer)clearTimeout(timer);};
 },[root,signature,refresh]);
 const current=items.find(n=>[...n.job_ids].sort().join(',')===signature);
 async function subscribe(){setBusy(true);setError(undefined);try{await api(root,{job_ids:jobIds},'POST');setRefresh(n=>n+1);}catch(e){setError(e);}finally{setBusy(false);}}
 async function cancel(){if(!current)return;setBusy(true);setError(undefined);try{await api(`${root}/${current.id}/cancel`,{},'POST');setRefresh(n=>n+1);}catch(e){setError(e);}finally{setBusy(false);}}
 if(!jobIds.length)return null;
 const status=current?.status;
 return <div className="generation-notification"><Notice error={error}/>
 {status&&waiting.includes(status)?<div className="actions"><span role="status">{status==='processing'?'Your update is being sent.':'We’ll email your account a link when this generation finishes.'}</span>{status!=='processing'&&<button type="button" disabled={busy} onClick={()=>void cancel()}>Cancel email</button>}</div>:status==='canceled'?<p role="status">Email canceled for this generation. Your saved work remains available.</p>:status==='accepted'?<p role="status">The update was accepted by the email service.</p>:status&&['failed','expired','unknown'].includes(status)?<p role="status">Email delivery could not be confirmed. Your saved work remains available.</p>:available&&loaded?<button type="button" disabled={busy} onClick={()=>void subscribe()}>{busy?'Saving…':'Email me a link when ready'}</button>:loaded?<p className="hint">You can leave this page. Your generation will continue in the background.</p>:null}
 {error!==undefined&&<button type="button" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>Check email status</button>}
 </div>;
}
