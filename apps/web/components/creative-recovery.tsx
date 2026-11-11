"use client";
import {useId,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';

export function CreativeRecovery({businessId,jobId,onRecovered,disabled=false}:{businessId:string;jobId:string;onRecovered:()=>Promise<void>;disabled?:boolean}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),description=useId();
 async function stop(){
  if(busy)return;
  setBusy(true);setError(undefined);
  try{await api(`/api/v1/businesses/${businessId}/creative-jobs/${jobId}/stop-waiting`,{acknowledge_possible_charge:true});await onRecovered();}
  catch(e){setError(e);}finally{setBusy(false);}
 }
 return <div className="creative-recovery">
  <Notice error={error}/>
  {confirm?<>
   <p id={description}>The provider may still charge for this request. Your saved work will remain available. Stopping here will not generate a replacement.</p>
   <div className="plan-actions" role="group" aria-label="Confirm stop waiting">
    <button type="button" disabled={disabled||busy} aria-describedby={description} onClick={()=>void stop()}>{busy?'Stopping…':'Stop waiting for this request'}</button>
    <button type="button" disabled={busy} onClick={()=>setConfirm(false)}>Keep waiting</button>
   </div>
  </>:<button type="button" disabled={disabled} onClick={()=>setConfirm(true)}>Stop waiting</button>}
 </div>;
}
