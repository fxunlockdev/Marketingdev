"use client";
import {memo,useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {api} from './api';
import {loadPrivateImage} from './load-private-image';
import {creativeDimensions} from '../../api/src/campaign-formats';
import {mediaPreviewPath,mediaSrcSet,pickPreviewWidth,postCoverSource,type MediaSource,type PreviewWidth} from '../../api/src/media-variants';
import styles from './media-image.module.css';

/** A second way to obtain the image when the stable preview URL fails (older API, preview error).
 * `release` frees a blob URL when the image unmounts. */
export type MediaFallback=(signal:AbortSignal)=>Promise<{url:string;release?:()=>void}>;
type LoadState='loading'|'ready'|'failed';
interface MediaImageOptions {businessId:string;source:MediaSource|null;intrinsicWidth?:number;fallback?:MediaFallback;
 /** Identifies the image when there is no previewable source (fallback only), so a change reloads it. */
 resetKey?:string}
interface MediaImageHandle {state:LoadState;instant:boolean;retry:()=>void;img:{src?:string;srcSet?:string;onLoad:()=>void;onError:()=>void;ref:(node:HTMLImageElement|null)=>void}}

// Images already shown in this tab: a re-render or re-mount paints them without a skeleton or fade.
const shown=new Set<string>();
// Preview routes this API has shown it does not serve yet; skip the doomed request for the rest of the session.
const unavailable=new Set<MediaSource['kind']>();
const identity=(businessId:string,source:MediaSource|null):string=>source?`${businessId}:${source.kind}:${source.id}`:'';

/** Loading state machine shared by every private image: stable cacheable URL first, one fallback, then a
 * visible failure that retries when the tab regains focus or the network returns. */
export function useMediaImage({businessId,source,intrinsicWidth,fallback,resetKey=''}:MediaImageOptions):MediaImageHandle{
 const id=identity(businessId,source),direct=!!source&&!unavailable.has(source.kind);
 const [state,setState]=useState<LoadState>(()=>shown.has(id)?'ready':'loading'),[override,setOverride]=useState(''),[attempt,setAttempt]=useState(0);
 const instant=useRef(shown.has(id)),controller=useRef<AbortController|null>(null),release=useRef<(()=>void)|undefined>(undefined),fallbackRef=useRef(fallback);
 fallbackRef.current=fallback;
 const recover=useCallback(()=>{
  const load=fallbackRef.current;
  if(!load||controller.current){if(!controller.current)setState('failed');return;}
  const current=new AbortController();controller.current=current;
  load(current.signal).then(result=>{
   if(current.signal.aborted){result.release?.();return;}
   if(source&&direct)unavailable.add(source.kind);
   release.current=result.release;setOverride(result.url);
  }).catch(()=>{if(!current.signal.aborted)setState('failed');});
 },[source?.kind,direct]);
 useEffect(()=>{
  setOverride('');setState(shown.has(id)?'ready':'loading');
  if(!direct&&fallbackRef.current)recover();
  return()=>{controller.current?.abort();controller.current=null;release.current?.();release.current=undefined;};
 },[id,resetKey,attempt,direct,recover]);
 useEffect(()=>{
  if(state!=='failed')return;
  const again=()=>setAttempt(n=>n+1);
  window.addEventListener('online',again);window.addEventListener('focus',again);
  return()=>{window.removeEventListener('online',again);window.removeEventListener('focus',again);};
 },[state]);
 const ready=useCallback(()=>{if(id)shown.add(id);setState('ready');},[id]);
 const src=override||(direct&&source?mediaPreviewPath(businessId,source,640):undefined);
 return {state,instant:instant.current,retry:()=>setAttempt(n=>n+1),img:{
  src,srcSet:!override&&direct&&source?mediaSrcSet(businessId,source,intrinsicWidth):undefined,
  onLoad:ready,
  onError:()=>{if(override||!direct)setState('failed');else recover();},
  // A cached image can finish before React attaches onLoad.
  ref:node=>{if(node?.complete&&node.naturalWidth>0)ready();},
 }};
}

export interface MediaImageProps {
 businessId:string;
 /** null means nothing has been generated yet. */
 source:MediaSource|null;
 /** Stored pixel dimensions of the original; they reserve the box so nothing shifts when the image arrives. */
 width:number;height:number;
 alt:string;
 /** CSS width of the slot, e.g. "64px" or "(max-width:760px) 100vw, 420px". */
 sizes:string;
 /** True only for the first visible image of a view. */
 priority?:boolean;
 /** Shown instead of an image while `source` is null. */
 emptyLabel?:string;
 fallback?:MediaFallback;
 className?:string;style?:CSSProperties;
}
/** The one way to show private generated media: sized variants, no layout shift, cacheable, with
 * distinct loading, not-generated and failed states. */
export const MediaImage=memo(function MediaImage({businessId,source,width,height,alt,sizes,priority=false,emptyLabel='Not generated yet',fallback,className,style}:MediaImageProps){
 const media=useMediaImage({businessId,source,intrinsicWidth:width,fallback});
 const state=source||fallback?media.state:'empty';
 return <span className={`${styles.frame}${className?` ${className}`:''}`} data-state={state} data-instant={media.instant} style={{aspectRatio:`${width} / ${height}`,...style}} aria-busy={state==='loading'}>
  <span className={styles.skeleton} aria-hidden="true"/>
  {state==='empty'?<span className={styles.note}><span className={styles.mark} aria-hidden="true">▧</span>{emptyLabel}</span>
  :state==='failed'?<span className={styles.note} role="alert">Image could not load<button type="button" className={styles.retry} onClick={media.retry}>Try again</button></span>
  :media.img.src&&<img {...media.img} alt={alt} sizes={sizes} width={width} height={height} decoding="async" loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'}/>}
 </span>;
});

interface CoverLayer {id:string;x:number;y:number;width:number;text:string;fontFamily:string;fontSize:number;fontWeight?:number;fill:string;align:CSSProperties['textAlign'];backing?:{padding:number;fill:string;opacity:number}}
interface CoverDesign {width:number;height:number;background_media_id?:string;layers?:CoverLayer[]}
export interface CoverPost {format?:string;generation_status?:string;design?:CoverDesign|null;creative_spec?:unknown;export_id?:string|null;slides?:{export_id?:string|null}[]|null;video_version_id?:string|null;carousel_version_id?:string|null;project_id?:string|null}

function coverFallback(root:string,source:MediaSource|null,post:CoverPost):MediaFallback|undefined{
 const blob=(endpoint:string,limit?:number):MediaFallback=>async signal=>{const url=URL.createObjectURL(await loadPrivateImage(endpoint,signal,limit));return {url,release:()=>URL.revokeObjectURL(url)};};
 if(!source)return undefined;
 if(source.kind==='creative')return blob(`${root}/creative-media/${source.id}`);
 if(source.kind==='export')return blob(`${root}/creative-exports/${source.id}/download`);
 if(source.kind==='poster')return blob(`${root}/video-versions/${source.id}/poster`,2*1024*1024);
 // APIs without the cover route: find the first slide the way cards did before.
 return async()=>{
  if(!post.project_id)throw new Error('Carousel preview unavailable');
  const result=await api<{versions:{id:string;pages?:{position:number;export_id:string}[]}[]}>(`${root}/carousels/${post.project_id}`);
  const cover=result.versions.find(v=>v.id===source.id)?.pages?.find(p=>p.position===0);
  if(!cover)throw new Error('Carousel preview unavailable');
  return {url:`${root}/creative-exports/${cover.export_id}/preview`};
 };
}

/** Card cover for a post. Same markup and wording as the earlier thumbnail (`.post-thumbnail`,
 * `.post-cover`, SVG text layers) so existing styles keep applying, but loaded through MediaImage's pipeline. */
export const PostCover=memo(function PostCover({businessId,post,priority=false,sizes='(max-width:760px) 100vw, 420px'}:{businessId:string;post:CoverPost;priority?:boolean;sizes?:string}){
 const root=`/api/v1/businesses/${businessId}`,found=postCoverSource(post),design=post.design??null;
 const dimensions=design??(post.creative_spec?creativeDimensions(post.creative_spec as Parameters<typeof creativeDimensions>[0]):null);
 // Video posters stay on the original image until the poster preview route is served.
 const source=found?.kind==='poster'?null:found;
 const media=useMediaImage({businessId,source,intrinsicWidth:design?.width,fallback:coverFallback(root,found,post),resetKey:found?`${found.kind}:${found.id}`:''});
 const layered=found?.kind==='creative'&&!!design;
 const host=useRef<HTMLSpanElement>(null),[variant,setVariant]=useState<PreviewWidth|null>(priority||!layered?640:null);
 useEffect(()=>{
  if(!layered||!host.current)return;
  const node=host.current,choose=()=>setVariant(pickPreviewWidth(node.clientWidth,window.devicePixelRatio));
  if(priority){choose();return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();choose();}},{rootMargin:'600px'});
  observer.observe(node);return()=>observer.disconnect();
 },[layered,priority,found?.id]);
 const generating=['queued','running','retrying'].includes(post.generation_status??'');
 const label=!found?(generating?'Generation in progress':post.format==='video'?'No video generated yet':post.format==='carousel'?'No slides generated yet':'No image generated yet'):media.state==='failed'?'Preview unavailable':'Loading preview…';
 const href=layered&&variant?(media.img.srcSet&&source?mediaPreviewPath(businessId,source,variant):media.img.src):undefined;
 const visible=found&&media.state!=='failed';
 return <span ref={host} className="post-thumbnail" style={dimensions?{aspectRatio:`${dimensions.width} / ${dimensions.height}`}:undefined} aria-hidden="true" data-state={!found?'empty':media.state}>
  {visible&&layered&&design&&href&&<svg viewBox={`0 0 ${design.width} ${design.height}`} style={media.state==='ready'?undefined:{position:'absolute',opacity:0}}><image href={href} width={design.width} height={design.height} onLoad={media.img.onLoad} onError={media.img.onError}/>{media.state==='ready'&&design.layers?.map(l=>{const pad=l.backing?.padding??0;return <foreignObject key={l.id} x={l.x-pad} y={l.y-pad} width={l.width+2*pad} height={design.height-l.y+pad}><div style={{fontFamily:l.fontFamily,fontSize:l.fontSize,fontWeight:l.fontWeight??400,boxSizing:'border-box',padding:pad,background:l.text.trim()&&l.backing?`${l.backing.fill}${Math.round(l.backing.opacity*255).toString(16).padStart(2,'0')}`:undefined,color:l.fill,textAlign:l.align,whiteSpace:'pre-wrap',lineHeight:1.16}}>{l.text}</div></foreignObject>;})}</svg>}
  {visible&&!layered&&media.img.src&&<img {...media.img} alt="" className="post-cover" sizes={sizes} width={dimensions?.width} height={dimensions?.height} decoding="async" loading={priority?'eager':'lazy'} fetchPriority={priority?'high':'auto'} style={media.state==='ready'?undefined:{position:'absolute',opacity:0}}/>}
  {media.state!=='ready'||!found?<><span className="post-format-mark">{post.format==='video'?'▷':'▧'}</span><span>{label}</span></>:null}
 </span>;
});
