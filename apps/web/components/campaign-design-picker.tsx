"use client";
import {useEffect,useState} from 'react';
import {CAMPAIGN_STYLES,CAMPAIGN_FONTS,type CampaignDesign} from '../../api/src/campaign-design';
import {api} from './api';
import {Notice} from './primitives';
import {PrivateVisual} from './private-visual';
type PreviewReference={id:string;visual_id:string;label:string;crop?:{left:number;top:number;width:number;height:number}|null};
export function CampaignDesignPicker({businessId,kind,value,onChange,name}:{businessId:string;kind:'style'|'font';value:CampaignDesign;onChange:(v:CampaignDesign)=>void;name:string}){
 const [references,setReferences]=useState<PreviewReference[]>(),[image,setImage]=useState(''),[error,setError]=useState<unknown>(),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setError(undefined);void api(`/api/v1/businesses/${businessId}/canvas/references`).then(data=>{if(active){setReferences(data.references);setImage(current=>data.references.some((r:PreviewReference)=>r.id===current)?current:data.references[0]?.id??'');}}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[businessId,reload]);
 const reference=references?.find(r=>r.id===image);
 return <fieldset className="campaign-design-options"><legend>{kind==='style'?'Choose a visual direction':'Choose your typography'}</legend><p>See how your campaign could look. Pick the one that feels like your brand.</p>
 <Notice error={error}/>{error?<button type="button" onClick={()=>setReload(n=>n+1)}>Retry preview images</button>:references===undefined?<p role="status">Loading your brand images…</p>:references.length>0?<div className="campaign-preview-toolbar"><div className="campaign-preview-field"><label htmlFor="campaign-preview-image">Preview image</label><select id="campaign-preview-image" value={image} onChange={e=>setImage(e.target.value)}>{references.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></div><button type="button" onClick={()=>setReload(n=>n+1)}>Refresh images</button></div>:<p className="hint">No approved brand images yet. You can still choose a style below.</p>}
 <div className="campaign-design-grid">{(kind==='style'?CAMPAIGN_STYLES:CAMPAIGN_FONTS).map(option=><label key={option.id} className={`campaign-design-choice ${value[kind]===option.id?'selected':''}`}>
  <input type="radio" aria-label={option.name} name={`campaign-${kind}`} value={option.id} checked={value[kind]===option.id} onChange={()=>onChange({...value,[kind]:option.id})}/>
  <span className={`campaign-design-preview ${reference?'has-brand-image':''} preview-${kind==='style'?option.id:value.style} font-${kind==='font'?option.id:value.font}`} aria-hidden="true">
   {reference&&<span className="sample-photo"><PrivateVisual key={`${reference.id}:${reload}`} presentation autoLoad businessId={businessId} visualId={reference.visual_id} crop={reference.crop} label="Preview image" alt=""/></span>}
   <span className="sample-eyebrow">YOUR NEXT CHAPTER</span><strong>{name||'Something worth sharing.'}</strong>{!reference&&<span className="sample-shape"/>}<span className="sample-caption">Made for the moments that matter.</span>
  </span>
  <span className="design-choice-name">{option.name}</span>{kind==='font'&&<span className="design-font-family">{'family' in option?option.family:''}</span>}<span className="design-choice-description">{option.description}</span>
 </label>)}</div><p className="hint">These are style previews. Choose the images for each post when you review its topic.</p></fieldset>;
}
