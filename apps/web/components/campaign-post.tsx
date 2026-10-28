"use client";
import "./campaign-redesign.css";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {api} from './api';
import {AppLink} from './app-link';
import {Notice,Loading} from './primitives';
import {CampaignBlogEditor} from './campaign-blog';
import {CampaignMediaLegacy} from './campaign-media-legacy';
import {SlotPanel} from './content-workspace';
import {BrandReferences} from './brand-references';
import {CanvasVideos,VideoRequest} from './video-canvas';
import {CampaignVideoReference,type GeneratedVideoReference} from './campaign-video-reference';
import {CampaignImages} from './campaign-images';
import './campaign-post.css';
export function CampaignPostScreen({business}:{business:{id:string;organization_id:string;name:string;role:string;has_approved_brand:boolean}}){
 const query=useSearchParams(),router=useRouter(),slotId=query.get('slot'),root=`/api/v1/businesses/${business.id}`;
 const [data,setData]=useState<any>(),[error,setError]=useState<unknown>(),[reference,setReference]=useState<{brand_reference_id:string;source_sha256:string;label:string}|GeneratedVideoReference>(),[threadId,setThreadId]=useState('');
 const threadKey=useRef(crypto.randomUUID()),threadPromise=useRef<Promise<string>|undefined>(undefined);
 const load=useCallback(async()=>{if(slotId)setData(await api(`${root}/content-slots/${slotId}`));},[root,slotId]);
 useEffect(()=>{const refresh=()=>void load().catch(setError);window.addEventListener('desvio-video-refresh',refresh);return()=>window.removeEventListener('desvio-video-refresh',refresh);},[load]);
 useEffect(()=>{setData(undefined);setError(undefined);setReference(undefined);setThreadId('');threadKey.current=crypto.randomUUID();threadPromise.current=undefined;void load().catch(setError);},[load]);
 const slot=data?.slot,existingThread=slot?.thread_id||data?.videos?.[0]?.thread_id;
 async function ensureThread(){if(threadId||existingThread)return threadId||existingThread;if(!threadPromise.current)threadPromise.current=api(root+'/canvas/threads',{title:slot?.brief.slice(0,140)||'Campaign video'},'POST',threadKey.current).then(v=>{setThreadId(v.id);return v.id;}).catch(e=>{threadPromise.current=undefined;throw e;});return threadPromise.current;}
 if(query.get('blog'))return <CampaignBlogEditor business={business} blogId={query.get('blog')!}/>;
 if(!slotId)return <CampaignMediaLegacy business={business}/>;
 return <section className="campaign-post-screen"><Notice error={error}/>{error&&<button onClick={()=>void load().catch(setError)}>Try again</button>}{!slot&&!error?<Loading/>:slot&&<><div className="heading-row"><AppLink href={`/b/${business.id}/campaign-review?plan=${slot.plan_id}`}>← {slot.plan_title}</AppLink><span>{slot.format==='video'?'Video post':'Post'}</span></div>{slot.format==='video'?<><h1>{slot.creative_spec?.placement==='reel'?'Short-form Video':'Feed Video Post'}</h1><p>{slot.brief}</p><details><summary>Post settings, approvals & saved versions</summary><SlotPanel business={business} slotId={slotId} onChanged={()=>void load().catch(setError)} onClose={()=>router.push(`/b/${business.id}/campaign-review?plan=${slot.plan_id}`)} onDirty={()=>{}}/></details>{(existingThread||threadId)&&<CanvasVideos business={business} threadId={existingThread||threadId}/>}<details open={!existingThread&&!threadId}><summary>{existingThread||threadId?'Create another version':'Choose your starting image'}</summary><p>Use an approved generated image or uploaded photo as your starting frame. Website captures cannot be used as video references.</p><CampaignVideoReference businessId={business.id} onSelect={setReference}/><BrandReferences businessId={business.id} writable={['owner','admin','editor'].includes(business.role)} visualPicker onVideo={setReference}/></details>{reference&&<VideoRequest key={`${slot.revision}:${'brand_reference_id' in reference?reference.brand_reference_id:reference.export_id}`} business={business} threadId={existingThread||threadId} reference={reference} ensureThread={ensureThread} initiallyOpen/>}</>:<><SlotPanel business={business} slotId={slotId} onChanged={()=>void load().catch(setError)} onClose={()=>router.push(`/b/${business.id}/campaign-review?plan=${slot.plan_id}`)} onDirty={()=>{}}/>{slot.format==='carousel'&&!slot.carousel_version_id&&<CampaignImages reviewed compact businessId={business.id} planId={slot.plan_id} slots={[slot]} disabled={!['owner','admin','editor'].includes(business.role)} onRefresh={()=>void load().catch(setError)}/>}</>}</>}</section>;
}
