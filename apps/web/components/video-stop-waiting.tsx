"use client";
import {useState} from 'react';
import {ActionButton} from './design-system';
import {api} from './api';
import {Notice} from './primitives';

interface VideoStopWaitingProps{businessId:string;jobId:string;disabled?:boolean;onStopped:()=>void}
/** Release a video or reel whose paid result is uncertain, so the next video can start. Nothing is resubmitted. */
export function VideoStopWaiting({businessId,jobId,disabled=false,onStopped}:VideoStopWaitingProps){
 const [acknowledged,setAcknowledged]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 async function stop(){setBusy(true);setError(undefined);try{await api(`/api/v1/businesses/${businessId}/requests/${jobId}/stop-waiting`,{acknowledge_possible_charge:true},'POST');onStopped();}catch(e){setError(e);}finally{setBusy(false);}}
 return <div className="video-stop-waiting" role="group" aria-label="Stop waiting for this video">
  <Notice error={error}/>
  <label><input type="checkbox" checked={acknowledged} disabled={busy||disabled} onChange={e=>setAcknowledged(e.target.checked)}/> I understand the video service may still charge for this request. It will not be sent again.</label>
  <ActionButton type="button" disabled={!acknowledged||busy||disabled} isLoading={busy} onClick={()=>void stop()} label="Stop waiting for this video"/>
 </div>;
}
/** "Generating shot 2 of 3…" for a reel in progress. */
export function reelProgressLabel(run:{shot_count?:number;shots?:{saved:boolean}[]}):string|null{
 const total=Number(run.shot_count??1);if(total<2||!Array.isArray(run.shots))return null;
 const saved=run.shots.filter(s=>s.saved).length;
 return saved>=total?'Cutting your reel with captions and end card…':`Generating shot ${saved+1} of ${total}…`;
}
