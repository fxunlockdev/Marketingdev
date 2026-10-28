"use client";
import {useEffect,useRef,useState} from 'react';
import {BrandReferences,SavedReferencePreviews} from './brand-references';
import {api,ApiError} from './api';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';

/** Edit the saved idea before media generation without leaving campaign review. */
export function PlannedTopic({businessId,slot,writable,onSaved,onEditing,showReferencePreview=true}:{businessId:string;slot:any;writable:boolean;showReferencePreview?:boolean;onSaved:(slot:any)=>void;onEditing:(id:string,editing:boolean)=>void}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(slot.brief),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false),[latest,setLatest]=useState<string>(),[references,setReferences]=useState<string[]>(slot.reference_ids??[]);
 const input=useRef<HTMLTextAreaElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useUnsavedChanges(editing&&(value!==slot.brief||JSON.stringify(references)!==JSON.stringify(slot.reference_ids??[])||busy));
 useEffect(()=>{onEditing(slot.id,editing);return()=>onEditing(slot.id,false);},[slot.id,editing,onEditing]);
 async function compareLatest(){setBusy(true);try{const data=await api(`/api/v1/businesses/${businessId}/content-slots/${slot.id}`);onSaved(data.slot);setLatest(data.slot.brief);setError(undefined);}catch(e){setError(e);}finally{setBusy(false);}}
 function close(){setEditing(false);setError(undefined);requestAnimationFrame(()=>trigger.current?.focus());}
 async function save(){if(busy||!value.trim())return;setBusy(true);setError(undefined);try{
  if(slot.state!=='content_needed'||!['static','carousel','video'].includes(slot.format)){setError(new Error('This post now has content or a review decision. Cancel and open the post to make changes.'));setBusy(false);return;}
  const updated=await api(`/api/v1/businesses/${businessId}/content-slots/${slot.id}`,{revision:slot.revision,brief:value.trim(),...(['static','carousel'].includes(slot.format)?{reference_ids:references}:{})},'PATCH');
  onSaved(updated);setSaved(true);close();
 }catch(e){setError(e);}finally{setBusy(false);}}
 return <div className="planned-topic">{editing?<form onSubmit={e=>{e.preventDefault();void save();}}><Field label="Post topic">{id=><textarea ref={input} id={id} value={value} maxLength={4000} required disabled={busy} onChange={e=>setValue(e.target.value)}/>}</Field>{['static','carousel'].includes(slot.format)&&<BrandReferences businessId={businessId} writable={false} selection={references} onSelectionChange={setReferences} disabled={busy} visualPicker/>}<Notice error={error}/>{error instanceof ApiError&&error.status===409&&<button type="button" disabled={busy} onClick={()=>void compareLatest()}>Compare with latest saved topic</button>}{latest!==undefined&&<aside><strong>Latest saved topic</strong><p>{latest}</p><p>Your draft stays above. Save it to replace this topic, or cancel to keep the saved version.</p></aside>}<div className="actions"><button className="primary" type="submit" disabled={busy||!value.trim()}>{busy?'Saving…':'Save topic'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button></div></form>:<><p className="post-topic-summary">{slot.hook||slot.brief}</p><details className="post-topic-details"><summary>View full brief</summary><p>{slot.brief}</p></details>{showReferencePreview&&<><SavedReferencePreviews businessId={businessId} ids={slot.reference_ids??[]}/>{!!slot.reference_ids?.length&&<p>{slot.reference_ids.length} reference {slot.reference_ids.length===1?'image':'images'} selected</p>}</>}{writable&&slot.state==='content_needed'&&['static','carousel','video'].includes(slot.format)&&<button ref={trigger} type="button" onClick={()=>{setValue(slot.brief);setReferences(slot.reference_ids??[]);setLatest(undefined);setSaved(false);setEditing(true);requestAnimationFrame(()=>input.current?.focus());}}>Edit topic</button>}{saved&&<p role="status">Topic saved.</p>}</>}</div>;
}
