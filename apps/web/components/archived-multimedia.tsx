"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Field,Loading,Notice} from './primitives';
import {VideoReview} from './video-canvas';
import {CarouselReview} from './carousels';
import {ProjectArchiveControl} from './project-archive-control';
export function ArchivedMultimedia({business,project,onRestored}:{business:{id:string;role:string};project:any;onRestored:()=>Promise<void>}){
 const [versions,setVersions]=useState<any[]>(),[selected,setSelected]=useState(project.latest_version_id),[error,setError]=useState<unknown>();
 useEffect(()=>{let active=true;const root=`/api/v1/businesses/${business.id}`;void api(project.kind==='video'?`${root}/video-versions/${project.latest_version_id}`:`${root}/carousels/${project.id}`).then(data=>{if(active)setVersions(data.versions);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[business.id,project.id,project.kind]);
 const version=versions?.find(v=>v.id===selected);
 return <section aria-label="Archived media history"><Notice error={error}/>{!versions&&!error&&<Loading/>}{versions&&<Field label="Saved media version">{id=><select id={id} value={selected} onChange={e=>setSelected(e.target.value)}>{versions.map((v,i)=><option key={v.id} value={v.id}>Version {versions.length-i} · {v.status.replaceAll('_',' ')}</option>)}</select>}</Field>}{project.kind==='video'?<VideoReview key={selected} business={business} id={selected} previewOnly/>:version&&<CarouselReview key={selected} businessId={business.id} version={version} canEdit={false} canReview={false} disabled={false} onOpenSlide={()=>{}} onSaved={async()=>{}}/>}{['owner','admin','editor'].includes(business.role)&&<ProjectArchiveControl businessId={business.id} kind={project.kind} project={project} onChanged={onRestored}/>}</section>;
}
