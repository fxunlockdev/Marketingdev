"use client";
import {useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
/** The project's archive state as the archive and restore routes return it. */
export type ArchiveState={id:string;archived_at:string|null;archive_revision:number};
export function ProjectArchiveControl({businessId,kind,project,onChanged,disabled=false}:{businessId:string;kind:'video'|'carousel';project:{id:string;archive_revision:number;archived_at?:string|null};onChanged:(updated:ArchiveState)=>void|Promise<void>;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[message,setMessage]=useState('');
 async function change(){setBusy(true);setError(undefined);try{const updated=await api<ArchiveState>(`/api/v1/businesses/${businessId}/canvas-projects/${kind}/${project.id}/${project.archived_at?'restore':'archive'}`,{revision:project.archive_revision});setMessage(project.archived_at?'Restored. Nothing has been scheduled or published.':'Archived. All versions are retained.');await onChanged(updated);}catch(e){setError(e);}finally{setBusy(false);}}
 return <><button disabled={busy||disabled} onClick={()=>void change()}>{project.archived_at?'Restore':'Archive'} {kind}</button><Notice error={error}/>{message&&<p role="status">{message}</p>}</>;
}
