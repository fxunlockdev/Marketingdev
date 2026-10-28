"use client";
import {useEffect,useState} from 'react';
import {api,type Workspace} from './api';
import {BrandFiles} from './uploads';
import {Notice} from './primitives';
import {PrivateVisual} from './private-visual';
import './media-connections-refinement.css';
import {StockPicker} from './stock-picker';
type Reference={id:string;visual_id:string;label:string;kind:string;sha256:string;width:number;height:number;crop?:{left:number;top:number;width:number;height:number}|null};
export function BrandReferences({businessId,writable,sources,selection,onSelectionChange,disabled=false,uploadWorkspace,onVideo,visualPicker=false,libraryMode=false}:{businessId:string;writable:boolean;sources?:any[];selection?:string[];onSelectionChange?:(ids:string[])=>void;disabled?:boolean;uploadWorkspace?:Workspace;visualPicker?:boolean;libraryMode?:boolean;onVideo?:(reference:{brand_reference_id:string;source_sha256:string;label:string})=>void}){
 const [uploadedSources,setUploadedSources]=useState<any[]>();
 const [mediaFilter,setMediaFilter]=useState('all'),[search,setSearch]=useState(''),[adding,setAdding]=useState(false);
 const matches=(label:string)=>label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
 const [references,setReferences]=useState<Reference[]>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const root=`/api/v1/businesses/${businessId}/canvas/references`;
 useEffect(()=>{let active=true;setReferences(undefined);setUploadedSources(undefined);setError(undefined);Promise.all([api(root),uploadWorkspace?api(`/api/v1/businesses/${businessId}/intake`):Promise.resolve(null)]).then(([r,intake])=>{if(active){setReferences(r.references);setUploadedSources(intake?.visuals);}}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[root,!!uploadWorkspace]);
 async function refresh(){const [r,intake]=await Promise.all([api(root),uploadWorkspace?api(`/api/v1/businesses/${businessId}/intake`):Promise.resolve(null)]);setReferences(r.references);if(intake)setUploadedSources(intake.visuals);}
 const availableSources=sources??uploadedSources;
 const unapprovedSources=(availableSources??[]).filter(v=>!references?.some(r=>r.visual_id===v.id));
 const sourceLabel=(v:any)=>v.viewport==='photo'?'Website photo':v.viewport==='upload'?'Uploaded photo':v.document_page?`Document page ${v.document_page}`:'Website capture';
 const visibleReferences=(references??[]).filter(r=>!libraryMode||(mediaFilter!=='review'&&matches(r.label)));
 const visibleSources=unapprovedSources.filter(v=>!libraryMode||(mediaFilter!=='approved'&&matches(sourceLabel(v))));
 async function revoke(id:string){setBusy(true);setError(undefined);try{await api(`${root}/${id}/revoke`,{});onSelectionChange?.((selection??[]).filter(v=>v!==id));await refresh();}catch(e){setError(e);}finally{setBusy(false);}}
 const Container=libraryMode?'section':'details';
 return <Container {...(!libraryMode?{open:visualPicker||undefined}:{})} className={`v5-panel reference-library ${visualPicker?'visual-reference-picker':''} ${libraryMode?'brand-media-library':''}`}>{!libraryMode&&<summary>{onSelectionChange?'Brand image references':'Approve images for future creatives'}{selection?.length?` · ${selection.length} selected`:''}</summary>}
  {libraryMode&&<div className="media-library-toolbar"><div><p className="media-library-count">{references===undefined?'Loading your media…':`${(references?.length??0)+unapprovedSources.length} ${(references?.length??0)+unapprovedSources.length===1?'image':'images'}`}</p><p>Your photos, ready for your next idea.</p></div>{uploadWorkspace&&writable&&<button type="button" className="primary" aria-expanded={adding} aria-controls="brand-media-add" onClick={()=>setAdding(v=>!v)}>{adding?'Close upload':'+ Add media'}</button>}</div>}
  {!libraryMode&&<p>{libraryMode?'Add your photos or review images found on your website.':onSelectionChange?'Choose up to three approved references for this request.':'Only images you explicitly approve here can be selected for AI creatives. Reviewing a brand fact or style does not approve image reuse.'}</p>}
  {uploadWorkspace&&writable&&(libraryMode?<div id="brand-media-add" hidden={!adding} className="media-add-panel"><BrandFiles key={businessId} org={uploadWorkspace} brandId={businessId} imagesOnly onReady={()=>{void refresh().catch(setError);}}/></div>:<details><summary>Add product photos</summary><BrandFiles key={businessId} org={uploadWorkspace} brandId={businessId} imagesOnly onReady={()=>{void refresh().catch(setError);}}/></details>)}
  {writable&&<StockPicker key={businessId} businessId={businessId} disabled={disabled||busy} onSelected={async referenceId=>{await refresh();if(onSelectionChange&&!selection?.includes(referenceId)&&(selection?.length??0)<3)onSelectionChange([...(selection??[]),referenceId]);}}/>}
  {libraryMode&&<div className="media-library-controls"><div role="group" aria-label="Media filter">{[['all','All media'],['approved','Approved'],['review','To review']].map(([value,label])=><button key={value} type="button" aria-pressed={mediaFilter===value} onClick={()=>setMediaFilter(value)}>{label}</button>)}</div><label className="media-library-search"><span className="sr-only">Search media</span><input type="search" placeholder="Search media" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}
  <Notice error={error}/>
  {references===undefined?(error?<button type="button" onClick={()=>{setError(undefined);void refresh().catch(setError);}}>Retry loading references</button>:<p role="status">Loading approved references…</p>):references.length===0&&!libraryMode?<p>No approved images yet. Upload a product photo or review your Brand sources, then approve a reference.</p>:<ul className="reference-list">{visibleReferences.map(r=><li key={r.id}>
   {onSelectionChange?<label className="reference-choice"><input type="checkbox" checked={selection?.includes(r.id)??false} disabled={disabled||busy||(!selection?.includes(r.id)&&(selection?.length??0)>=3)} onChange={e=>onSelectionChange(e.target.checked?[...(selection??[]),r.id]:(selection??[]).filter(v=>v!==r.id))}/>{r.label}</label>:<strong>{r.label}</strong>}
   <PrivateVisual autoLoad={visualPicker||libraryMode} businessId={businessId} visualId={r.visual_id} label={`Preview ${r.label}`} alt={r.label} crop={r.crop}/>
   {onVideo&&writable&&r.kind==='upload'&&(r.crop?<p>Video uses the full photo. Approve it without a crop to use it for video.</p>:r.width>=64&&r.height>=64?<button type="button" disabled={busy||disabled} onClick={()=>onVideo({brand_reference_id:r.id,source_sha256:r.sha256,label:r.label})}>Use {r.label} for video</button>:<p>Video references must be at least 64 × 64 pixels.</p>)}
   {writable&&<button type="button" disabled={busy||disabled} aria-label={`Remove approval for ${r.label}`} onClick={()=>void revoke(r.id)}>{libraryMode?'Remove approval':`Remove approval for ${r.label}`}</button>}
  </li>)}</ul>}
  {references&&onSelectionChange&&(selection??[]).filter(id=>!references.some(r=>r.id===id)).map((id,index)=><p key={id} className="unavailable-reference">An image is no longer available. <button type="button" disabled={disabled||busy} aria-label={`Remove unavailable image ${index+1}`} onClick={()=>onSelectionChange((selection??[]).filter(value=>value!==id))}>Remove image</button></p>)}
  {availableSources&&(writable||libraryMode)&&<div className={libraryMode?'brand-media-grid':undefined}>{visibleSources.map(v=>libraryMode?<details className="brand-media-tile" key={v.id}><summary><PrivateVisual autoLoad presentation businessId={businessId} visualId={v.id} label="Preview media" alt={v.viewport==='photo'?'Website photo':v.viewport==='upload'?'Uploaded photo':'Brand source image'}/><span>{v.viewport==='photo'?'Website photo':v.viewport==='upload'?'Uploaded photo':v.document_page?`Document page ${v.document_page}`:'Website capture'}</span><span className="hint">Review image</span></summary><ApproveReference businessId={businessId} visual={v} disabled={busy||disabled||!references||!writable} onSaved={refresh}/></details>:<ApproveReference key={v.id} businessId={businessId} visual={v} disabled={busy||disabled||!references} onSaved={refresh}/>)}</div>}
  {libraryMode&&references!==undefined&&!visibleReferences.length&&!visibleSources.length&&<div className="media-library-empty"><h3>{search?'No matching images':mediaFilter==='review'?'All caught up':mediaFilter==='approved'?'No approved images yet':'Make this space yours'}</h3><p>{search?'Try another name.':mediaFilter==='approved'?'Open an image in To review to approve it.':'Add your photos to build your brand’s visual library.'}</p></div>}
  {!libraryMode&&!!references?.length&&<p>Removing approval stops new provider submissions. A request already submitted may still finish; saved creatives remain in their history.</p>}
 </Container>;
}
function ApproveReference({businessId,visual,disabled,onSaved}:{businessId:string;visual:any;disabled:boolean;onSaved:()=>Promise<void>}){
 const title=visual.viewport==='photo'?'Website photo':visual.viewport==='upload'?'Uploaded product photo':visual.document_page?`Document page ${visual.document_page}`:`${visual.viewport} website capture`;
 const [cropping,setCropping]=useState(false),[shape,setShape]=useState('custom'),[crop,setCrop]=useState({left:0,top:0,width:visual.width,height:visual.height});
 const validCrop=[crop.left,crop.top,crop.width,crop.height].every(Number.isSafeInteger)&&crop.left>=0&&crop.top>=0&&crop.width>0&&crop.height>0&&crop.left+crop.width<=visual.width&&crop.top+crop.height<=visual.height;
 const [label,setLabel]=useState(title),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 async function approve(){setBusy(true);setError(undefined);try{await api(`/api/v1/businesses/${businessId}/canvas/references`,{kind:visual.viewport==='upload'?'upload':visual.document_page?'document':'website',visual_id:visual.id,label,consent,...(cropping?{crop}:{})});await onSaved();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section aria-label={`Approve reference: ${title}`}><h4>{title}</h4>
  <PrivateVisual businessId={businessId} visualId={visual.id} label={`Inspect ${title}`} alt={title}/>
  <label className="reference-choice"><input type="checkbox" checked={cropping} disabled={disabled||busy} onChange={e=>{setCropping(e.target.checked);setConsent(false);}}/>Use part of this image</label>
  {cropping&&<fieldset><legend>Choose your crop</legend>
   <label>Crop shape<select value={shape} disabled={disabled||busy} onChange={e=>{const value=e.target.value;setShape(value);setConsent(false);if(value==='custom')return;const ratio=value==='square'?1:value==='portrait'?4/5:16/9,width=Math.min(visual.width,Math.floor(visual.height*ratio)),height=Math.min(visual.height,Math.floor(width/ratio));setCrop({left:Math.floor((visual.width-width)/2),top:Math.floor((visual.height-height)/2),width,height});}}><option value="custom">Custom crop</option><option value="square">Square</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
   <details open={shape==='custom'}><summary>Adjust crop position and size</summary><p>Source size: {visual.width} × {visual.height} pixels.</p>
   {(['left','top','width','height'] as const).map(k=><label key={k}>{({left:'Crop left',top:'Crop top',width:'Crop width',height:'Crop height'})[k]}<input type="number" min={k==='left'||k==='top'?0:1} max={k==='left'||k==='width'?visual.width:visual.height} step="1" value={Number.isFinite(crop[k])?crop[k]:''} disabled={disabled||busy} onChange={e=>{setCrop({...crop,[k]:e.target.valueAsNumber});setShape('custom');setConsent(false);}}/></label>)}
   </details>
   {!validCrop?<p role="alert">Choose a crop within the source image.</p>:<PrivateVisual businessId={businessId} visualId={visual.id} crop={crop} label="Preview selected crop" alt="Selected reference crop"/>}
  </fieldset>}
  <label>Reference name<input value={label} maxLength={140} disabled={disabled||busy} onChange={e=>setLabel(e.target.value)}/></label>
  <label className="reference-choice"><input type="checkbox" checked={consent} disabled={disabled||busy} onChange={e=>setConsent(e.target.checked)}/>I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.</label>
  <button type="button" disabled={disabled||busy||!consent||!label.trim()||(cropping&&!validCrop)} onClick={()=>void approve()}>{busy?'Saving approval…':'Approve image reference'}</button><Notice error={error}/>
 </section>;
}

/** Show the saved choices without exposing private object URLs or editing them. */
export function SavedReferencePreviews({businessId,ids}:{businessId:string;ids:string[]}){
 const [references,setReferences]=useState<Reference[]>(),[error,setError]=useState<unknown>(),[reload,setReload]=useState(0);
 const selection=JSON.stringify(ids);
 useEffect(()=>{let active=true;setReferences(undefined);setError(undefined);
  if(!ids.length)return;
  void api(`/api/v1/businesses/${businessId}/canvas/references`).then(data=>{if(active)setReferences(data.references);}).catch(e=>{if(active)setError(e);});
  return()=>{active=false;};
 },[businessId,selection,reload]);
 if(!ids.length)return null;
 return <div className="saved-reference-previews" role="group" aria-label="Selected reference images">
  <Notice error={error}/>{error?<button type="button" onClick={()=>setReload(n=>n+1)}>Retry image previews</button>:references===undefined?<p role="status">Loading selected images…</p>:ids.map(id=>{const reference=references.find(r=>r.id===id);return reference?<figure key={id}><PrivateVisual autoLoad businessId={businessId} visualId={reference.visual_id} label={`Preview ${reference.label}`} alt={reference.label} crop={reference.crop}/><figcaption>{reference.label}</figcaption></figure>:<p key={id}>This image is no longer available. Edit the topic to choose another.</p>;})}
 </div>;
}
