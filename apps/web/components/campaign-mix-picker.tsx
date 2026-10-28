"use client";
import {useEffect,useState} from 'react';
import type {ContentMixItem} from '../../api/src/generation-plan';
import type {CreativeSpec} from '../../api/src/campaign-formats';
import {api} from './api';
import {PrivateVisual} from './private-visual';
import {Field} from './primitives';
import styles from './campaign-mix-picker.module.css';
export const MIX_CHOICES=[
 {id:'image',name:'Image posts',format:'static',placement:'feed',description:'A single image for your feed.'},
 {id:'carousel',name:'Carousels',format:'carousel',placement:'feed',description:'One story across coordinated slides.'},
 {id:'image-story',name:'Image stories',format:'static',placement:'story',description:'A full-screen image, made vertical.'},
 {id:'reel',name:'Reels',format:'video',placement:'reel',description:'A vertical video with a reviewed script.'},
 {id:'video-story',name:'Video stories',format:'video',placement:'story',description:'A short full-screen video.'},
 {id:'video',name:'Video posts',format:'video',placement:'feed',description:'Video in your chosen feed shape.'},
] as const;
export function defaultMix(channels:string[],images:number,videos=0):ContentMixItem[]{
 if(!channels.length)return [];
 return channels.flatMap((channel,i)=>{
  const imageCount=Math.floor(images/channels.length)+(i<images%channels.length?1:0),videoCount=Math.floor(videos/channels.length)+(i<videos%channels.length?1:0);
  return [...(imageCount?[{channel:channel as ContentMixItem['channel'],format:'static' as const,creative_spec:{placement:'feed' as const,aspect:'square' as const,slide_count:null},count:imageCount}]:[]),...(videoCount?[{channel:channel as ContentMixItem['channel'],format:'video' as const,creative_spec:{placement:channel==='linkedin'?'feed' as const:'reel' as const,aspect:channel==='linkedin'?'portrait' as const:'vertical' as const,slide_count:null},count:videoCount}]:[])];
 });
}
export function CampaignMixPicker({businessId,channels,value,onChange}:{businessId:string;channels:string[];value:ContentMixItem[];onChange:(mix:ContentMixItem[])=>void}){
 const [active,setActive]=useState(channels[0]??''),[reference,setReference]=useState<any>();
 useEffect(()=>{if(!channels.includes(active))setActive(channels[0]??'');},[channels,active]);
 useEffect(()=>{let live=true;void api(`/api/v1/businesses/${businessId}/canvas/references`).then(data=>{if(live)setReference(data.references?.[0]);}).catch(()=>{});return()=>{live=false;};},[businessId]);
 function update(choice:typeof MIX_CHOICES[number],patch:{count?:number;aspect?:CreativeSpec['aspect'];slide_count?:number}){
  const row=value.find(r=>r.channel===active&&r.format===choice.format&&r.creative_spec.placement===choice.placement);
  const next:ContentMixItem={channel:active as ContentMixItem['channel'],format:choice.format,count:patch.count??row?.count??0,creative_spec:{placement:choice.placement,aspect:patch.aspect??row?.creative_spec.aspect??(choice.placement==='feed'?'square':'vertical'),slide_count:choice.format==='carousel'?(patch.slide_count??row?.creative_spec.slide_count??3):null}};
  const remaining=value.filter(r=>!(r.channel===active&&r.format===choice.format&&r.creative_spec.placement===choice.placement));onChange(next.count>0?[...remaining,next]:remaining);
 }
 return <section aria-label="Content mix"><div className={styles.tabs} role="group" aria-label="Choose a platform">{channels.map(channel=><button key={channel} type="button" aria-pressed={active===channel} onClick={()=>setActive(channel)}>{channel==='instagram'?'Instagram':channel==='facebook'?'Facebook':'LinkedIn'}</button>)}</div><div className={styles.grid}>{MIX_CHOICES.filter(c=>active!=='linkedin'||c.placement==='feed').map(choice=>{
 const row=value.find(r=>r.channel===active&&r.format===choice.format&&r.creative_spec.placement===choice.placement),count=row?.count??0;
 return <article key={`${active}:${choice.id}`} className={styles.card}><div className={`${styles.preview} ${choice.placement!=='feed'?styles.vertical:''}`} aria-hidden="true"><div className={styles.picture}>{reference?<PrivateVisual presentation autoLoad businessId={businessId} visualId={reference.visual_id} crop={reference.crop} label="Brand image" alt=""/>:<span className={styles.sample}>Your brand<br/>in the spotlight</span>}{choice.format==='video'&&<span className={styles.play}>▷</span>}{choice.format==='carousel'&&<span className={styles.slides}>1 / {row?.creative_spec.slide_count??3}</span>}</div></div><h2>{choice.name}</h2><p>{choice.description}</p><Field label={choice.name}>{id=><input id={id} type="number" min={0} max={choice.format==='video'?30:90} value={count} onChange={e=>update(choice,{count:Number(e.target.value)})}/>}</Field>{choice.placement==='feed'&&count>0&&<Field label={`${choice.name} shape`}>{id=><select id={id} value={row?.creative_spec.aspect??'square'} onChange={e=>update(choice,{aspect:e.target.value as CreativeSpec['aspect']})}><option value="square">Square · 1:1</option><option value="portrait">Portrait · 2:3</option><option value="landscape">Landscape · 3:2</option></select>}</Field>}{choice.format==='carousel'&&count>0&&<Field label="Slides per carousel">{id=><input id={id} type="number" min={2} max={10} value={row?.creative_spec.slide_count??3} onChange={e=>update(choice,{slide_count:Number(e.target.value)})}/>}</Field>}</article>;
 })}</div><p className="hint">Format previews use your brand photo when available. Video scripts and starting images are reviewed before video generation.</p></section>;
}
