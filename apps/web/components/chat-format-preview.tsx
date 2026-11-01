"use client";
export const creationLabels:Record<string,string>={post:'Post',image:'Image',carousel:'Carousel',reel:'Reel',video:'Video',story:'Story',campaign:'Campaign'};
export function isVisualKind(value:string){return ['post','image','carousel','reel','video','story'].includes(value);}
/** An empty artboard communicates format, never a generated or playable asset. */
export function ChatFormatPreview({kind,brand,status='Draft',channel,shape,children}:{kind:string;brand:string;status?:string;channel?:string;shape?:string;children?:React.ReactNode}){
 const vertical=kind==='reel'||kind==='story',label=creationLabels[kind]??'Image';
 return <section className={`chat-format-preview format-${kind}`} aria-label={`${label} canvas preview`}>
 {children??<div className={`chat-format-frame ${vertical?'vertical':shape??(kind==='video'?'landscape':'square')}`} role="img" aria-label={`${label} layout preview. No media has been generated yet.`}>
 {kind==='carousel'&&<><span className="chat-stack-sheet back" aria-hidden="true"/><span className="chat-stack-sheet front" aria-hidden="true"/></>}
 <div className="chat-format-artboard"><span className="chat-format-outline" aria-hidden="true"/>
 {vertical&&<div className="chat-format-profile"><div className="chat-format-ticks" aria-hidden="true"><i/><i/><i/></div><span><b aria-hidden="true">{brand.slice(0,1).toUpperCase()}</b>{brand}</span></div>}
 {(kind==='reel'||kind==='video')&&<span className="chat-format-play" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>}
 <div className="chat-format-lines" aria-hidden="true"><i/><i/></div><strong className="chat-format-brand">{brand}</strong>
 {kind==='carousel'&&<span className="chat-format-dots" aria-hidden="true"><i/><i/><i/></span>}
 </div></div>}
 <div className="chat-format-meta" aria-label="Creative details"><span className="pending-detail">Image</span><i aria-hidden="true"/><span className="pending-detail">Campaign</span><i aria-hidden="true"/><span>{label}</span><i aria-hidden="true"/><span className={channel?'':'pending-detail'}>{channel??'Channel'}</span><i aria-hidden="true"/><span className="pending-detail">Date</span><i aria-hidden="true"/><strong role="status">{status}</strong></div>
 </section>;
}
