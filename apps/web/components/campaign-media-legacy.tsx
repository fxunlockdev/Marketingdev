"use client";
import {useEffect,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {api} from './api';
import {AppLink} from './app-link';
import {CreativeProject} from './canvas';
import {CanvasVideos} from './video-canvas';
import {CanvasCarousels} from './carousels';
import {Notice,Loading} from './primitives';
/** Saved media remains editable after retiring the conversation surface. */
export function CampaignMediaLegacy({business}:{business:{id:string;organization_id:string;name:string;role:string;has_approved_brand:boolean}}){
 const query=useSearchParams(),router=useRouter(),thread=query.get('thread'),project=query.get('project'),carousel=query.get('carousel');
 const [projects,setProjects]=useState<any[]>(),[error,setError]=useState<unknown>();
 useEffect(()=>{let live=true;setProjects(undefined);setError(undefined);if(thread&&!project)api(`/api/v1/businesses/${business.id}/canvas/threads/${thread}`).then(v=>{if(live)setProjects(v.projects);}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[business.id,thread,project]);
 return <section className="campaign-post-screen"><AppLink href={`/b/${business.id}/campaigns`}>← Campaigns</AppLink><h1>Saved media</h1><Notice error={error}/>{project?<CreativeProject business={business} projectId={project}/>:carousel?<CanvasCarousels businessId={business.id} initiallyOpen onOpenSlide={(t,p)=>router.push(`/b/${business.id}/campaign-post?thread=${t}&project=${p}`)}/>:thread?<>{!projects&&!error&&<Loading/>}{projects?.map(p=><CreativeProject key={p.id} business={business} projectId={p.id}/>)}<CanvasVideos business={business} threadId={thread}/></>:<p>Choose a campaign to create or edit your media.</p>}</section>;
}
