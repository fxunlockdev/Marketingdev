"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {Notice} from './primitives';
import {CreativeEditor} from './creative-editor';
import {CreativeProject} from './canvas';
import {CanvasVideos,VideoRequest} from './video-canvas';
import './create-chat.css';
import './conversation-chat.css';
type Business={id:string;name:string;role:string;has_approved_brand:boolean;organization_id?:string};
const pending=(s:string)=>['queued','running','retrying'].includes(s);
export function ConversationChat({business}:{business:Business}){
 const router=useRouter(),root=`/api/v1/businesses/${business.id}`;
 const [initializing,setInitializing]=useState(true);
 const [id,setId]=useState(''),[data,setData]=useState<any>(),[canvas,setCanvas]=useState<any>(),[text,setText]=useState(''),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[history,setHistory]=useState(false),[search,setSearch]=useState(''),[items,setItems]=useState<any[]>([]),[refresh,setRefresh]=useState(0),[editor,setEditor]=useState(false),[dirty,setDirty]=useState(false),[references,setReferences]=useState<any[]>([]),[reference,setReference]=useState('');
 const lock=useRef(false),request=useRef<{key:string;body:any}|null>(null),started=useRef(false),log=useRef<HTMLDivElement>(null);
 const writable=['owner','admin','editor'].includes(business.role),last=data?.turns?.at(-1),working=initializing||busy||last?.action_status==='queued'||pending(last?.status)||canvas?.runs?.some((r:any)=>pending(r.status))||canvas?.planning_runs?.some((r:any)=>pending(r.status)),uncertain=last?.status==='unknown'||canvas?.runs?.some((r:any)=>r.status==='unknown');
 const latestProject=canvas?.projects?.find((p:any)=>p.latest_version_id),latestRun=canvas?.runs?.[0];
 function leaveEdits(){return !(dirty||text.trim())||window.confirm('Leave your unsaved edits? Your sent conversation is saved.');}
 function navigate(url:string){if(!busy&&leaveEdits())router.push(url);}
 function choose(value:string){setDirty(false);setId(value);setData(undefined);setCanvas(undefined);setEditor(false);setHistory(false);setError(undefined);setReference('');setText('');router.replace(`/b/${business.id}/create?conversation=${value}`);}
 async function deliver(envelope:{key:string;body:any}){
  // Keep this exact envelope until the server confirms both acceptance and acknowledgement.
  request.current=envelope;
  await api(root+'/create-chat/outbox',envelope,'PUT');
  const r=await api(root+'/create-chat/messages',envelope.body,'POST',envelope.key);
  window.history.replaceState(null,'',`/b/${business.id}/create?conversation=${r.conversation_id}`);
  await api(root+'/create-chat/outbox/'+encodeURIComponent(envelope.key)+'/acknowledge',{});
  request.current=null;setText('');choose(r.conversation_id);setRefresh(n=>n+1);
 }
 async function send(message=text){if(lock.current||dirty||!message.trim()||!writable)return;lock.current=true;setBusy(true);setError(undefined);
  try{await deliver(request.current??{key:crypto.randomUUID(),body:{conversation_id:id||null,message:message.trim()}});}
  catch(e){setError(e);}finally{setBusy(false);lock.current=false;}
 }
 useEffect(()=>{if(started.current)return;started.current=true;void(async()=>{
  try{const saved=await api(root+'/create-chat/outbox');
   if(saved.request){setBusy(true);lock.current=true;await deliver(saved.request);return;}
   const q=new URLSearchParams(location.search),conversation=q.get('conversation');if(conversation){choose(conversation);return;}
   if(q.get('history'))setHistory(true);
   // A completed initial prompt is replaced by its conversation URL. Never replay it on refresh.
   if(q.get('q'))await send(q.get('q')!);
   else if(q.get('start')){const start=q.get('start')!;setText(({post:'I want to create an image about ',video:'Create a video about ',reel:'Create a reel about ',story:'Create a story image about ',carousel:'Create a carousel about ',campaign:'Create a campaign about ',strategy:'Create a recurring strategy for '} as Record<string,string>)[start]??'');}
  }catch(e){setError(e);}finally{lock.current=false;setBusy(false);setInitializing(false);}
 })();},[]);
 useEffect(()=>{let live=true;const timer=setTimeout(()=>void api(root+'/create-chat/history?q='+encodeURIComponent(search)).then(r=>{if(live)setItems(r.conversations);}).catch(e=>{if(live)setError(e);}),200);return()=>{live=false;clearTimeout(timer);};},[root,history,search,refresh]);
 useEffect(()=>{if(!id)return;let live=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const [d,c]=await Promise.all([api(root+'/create-chat/conversations/'+id),api(root+'/canvas/threads/'+id)]);if(!live)return;setData(d);setCanvas(c);

   }catch(e){if(live)setError(e);}if(live)timer=setTimeout(poll,2500);};void poll();return()=>{live=false;clearTimeout(timer);};},[root,id,refresh,writable]);
 useEffect(()=>{log.current?.scrollTo({top:log.current.scrollHeight,behavior:'instant'});},[data?.turns?.length,last?.status]);
 useEffect(()=>{if(last?.output?.action!=='video')return;let live=true;void api(root+'/canvas/references').then(r=>{if(live)setReferences(r.references);}).catch(setError);return()=>{live=false;};},[root,last?.id,last?.output?.action]);
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(text.trim()||dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[text,dirty,busy]);
 function fresh(){if(request.current||busy||initializing)return;if((text.trim()||dirty)&&!window.confirm('Leave your unsaved edits and start a new conversation?'))return;setId('');setData(undefined);setCanvas(undefined);setText('');setError(undefined);setEditor(false);setDirty(false);router.replace(`/b/${business.id}/create`);}
 const action=last?.output?.action;
 return <section className="create-chat-screen conversation-screen" aria-label="Create with Desvio">
 <div className="create-chat-panel"><header><span className="create-chat-wordmark">desvio<span>.</span></span><button disabled={busy||initializing||!!request.current} onClick={()=>setHistory(true)}>History</button><button onClick={fresh} disabled={busy||initializing||!!request.current}>New chat</button><button aria-label="Close chat" disabled={busy} onClick={()=>navigate(`/b/${business.id}`)}>×</button></header>
 <div className="create-chat-log" ref={log} role="log" aria-live="polite">
 {!data?.turns?.length&&<><Message role="assistant" text="What would you like to create? Tell me the idea, audience and anything you have in mind."/><div className="create-start-tiles">{[['image','Image','Create a luxury residences image for young families'],['campaign','Campaign','Plan a campaign for our new launch'],['strategy','Strategy','Help me build a recurring content strategy']].map(([key,label,prompt])=><button key={key} className={key} onClick={()=>setText(prompt)}><strong>{label}</strong><span>›</span></button>)}</div></>}
 {data?.turns?.map((t:any)=><div key={t.id}><Message role="user" text={t.message}/>{t.output&&<><Message role="assistant" text={t.output.reply}/>{t.sources?.length>0&&<p className="conversation-sources">From saved history: {t.sources.map((source:any)=><button key={source.id} onClick={()=>{if(busy||!leaveEdits())return;if(source.kind==='conversation')choose(source.id);else router.push(`/b/${business.id}/campaign-review?plan=${source.id}`);}}>{source.title}</button>)}</p>}</>}{pending(t.status)&&<Message role="assistant" text="Thinking through your request…"/>}{['unknown','failed','rejected','canceled'].includes(t.status)&&<p className="conversation-problem" role="status">{t.status==='unknown'?'The provider response could not be confirmed. Your message is saved; another paid request will not be sent automatically.':'This request could not finish. Your message is saved. You can send a revised request.'}</p>}</div>)}
 </div>
 <Notice error={error}/>{!!error&&<button disabled={busy} onClick={()=>{setError(undefined);if(request.current)void send(request.current.body.message);else setRefresh(n=>n+1);}}>Retry saved request</button>}
 {!!error&&!!request.current&&<button disabled={busy} onClick={async()=>{const saved=request.current;if(!saved)return;setBusy(true);try{await api(root+'/create-chat/outbox/'+encodeURIComponent(saved.key)+'/discard',{});request.current=null;setText(saved.body.message);setError(undefined);}catch(e){setError(e);}finally{setBusy(false);}}}>Return to editing unsent message</button>}
 {last?.action_status==='failed'&&<div className="conversation-problem" role="status"><p>Your creative could not start. Your request is saved.</p><button disabled={busy} onClick={async()=>{setBusy(true);try{await api(root+`/create-chat/turns/${last.id}/execute`,{});setRefresh(n=>n+1);}catch(e){setError(e);}finally{setBusy(false);}}}>Try starting this creative again</button></div>}
 {dirty&&<p role="status">Save your canvas edits before sending another instruction.</p>}
 <form className="create-composer text-enabled" onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="Message Desvio" placeholder={latestProject?'Tell me what to change…':'Describe what you want to create…'} maxLength={4000} rows={2} value={text} disabled={!writable||busy||initializing} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!working&&!uncertain)void send();}}}/><button aria-label="Send message" disabled={!writable||!text.trim()||working||uncertain||dirty} type="submit">↑</button></form><span className="create-save-state" role="status">{busy?'Saving your message…':id?'Conversation saved · Available in History':'Your conversations are saved when you send'}</span>
 </div>
 <div className="create-live-canvas"><header><span><i aria-hidden="true"/>Live canvas</span><span>{business.name}{action&&action!=='answer'?` · ${action.replace('_',' ')}`:''}</span><button disabled={busy} onClick={()=>navigate(`/b/${business.id}`)}>Back to Desvio</button></header><div className="create-preview-area conversation-preview">
 {latestProject?<section className="conversation-artwork"><header><h1>Your creative</h1><button onClick={()=>{if(editor&&dirty&&!window.confirm('Discard unsaved design edits?'))return;setDirty(false);setEditor(v=>!v);}}>{editor?'Close editor':'Edit design'}</button></header>{editor?<CreativeProject business={{...business,organization_id:business.organization_id??''}} projectId={latestProject.id} refresh={latestProject.latest_version_id} onDirty={setDirty}/>:<ChatArtwork businessId={business.id} projectId={latestProject.id} revision={latestProject.latest_version_id}/>}</section>:<article className="create-brief-card"><div className="create-card-heading"><span>{business.name}</span><span className="create-card-status">{working?'● Creating':uncertain?'Needs attention':'Your canvas'}</span></div><h1>{working?'Your idea is taking shape.':'Your idea lands here.'}</h1><p>{latestRun&&!pending(latestRun.status)&&latestRun.status!=='succeeded'?`Image ${latestRun.status}. Your conversation is saved; no empty preview is marked ready.`:working?'You can leave this page. Return through History to see the result.':'Ask for an image, a video or a campaign. Your saved creations appear here.'}</p></article>}
 {latestProject&&latestRun&&pending(latestRun.status)&&<p className="conversation-progress" role="status">Creating your next version. Your previous image stays available.</p>}
 {latestProject&&latestRun&&['failed','rejected','unknown','canceled'].includes(latestRun.status)&&<p className="conversation-problem">Your last image request {latestRun.status==='unknown'?'needs reconciliation':latestRun.status}. The previous version is preserved.</p>}
 {canvas?.planning_runs?.some((r:any)=>pending(r.status))&&<p className="conversation-progress" role="status">Planning your campaign. Your conversation and progress are saved.</p>}
 {canvas?.planning_runs?.filter((r:any)=>r.output_plan_id).map((r:any)=><a className="conversation-campaign" key={r.id} href={`/b/${business.id}/campaign-review?plan=${r.output_plan_id}`}>Review your saved campaign →</a>)}
 {action==='video'&&<section className="conversation-artwork"><h2>Create your video</h2><p>Choose an approved reference image, then review the script before generation.</p>{references.length?<><label htmlFor="chat-video-reference">Reference image</label><select id="chat-video-reference" value={reference} onChange={e=>setReference(e.target.value)}><option value="">Choose an image</option>{references.map(r=><option key={r.id} value={r.id}>{r.title??r.label??r.id}</option>)}</select>{reference&&<VideoRequest key={`${last.id}:${reference}`} business={business} threadId={id} reference={{brand_reference_id:reference,source_sha256:references.find(r=>r.id===reference).sha256}} initiallyOpen initialPrompt={last.output.prompt}/>}</>:<a href={`/b/${business.id}/brand-kit`}>Add a reference image in Brand Kit</a>}</section>}
 {action==='strategy'&&<a className="conversation-campaign" href={`/b/${business.id}/create?guided=1&start=strategy`}>Choose and authorize your recurring strategy →</a>}
 {id&&<CanvasVideos business={business} threadId={id}/>}
 </div></div>
 {history&&<ChatHistory onClose={()=>setHistory(false)}><header><h2>Conversation history</h2><button aria-label="Close history" onClick={()=>setHistory(false)}>×</button></header><label htmlFor="chat-history-search">Search this business’s conversations</label><input id="chat-history-search" autoFocus placeholder="Try a campaign or an idea…" value={search} onChange={e=>setSearch(e.target.value)}/><ul>{items.map(c=><li key={c.id}><button onClick={()=>{if(busy||!leaveEdits())return;choose(c.id);}}><strong>{c.title}</strong><span>{new Date(c.updated_at).toLocaleDateString()}</span></button></li>)}</ul>{!items.length&&<p>No saved conversations found.</p>}<p>Only your conversations for {business.name} appear here.</p></ChatHistory>}
 </section>;
}
function Message({role,text}:{role:string;text:string}){return <div className={`create-message ${role}`}>{role==='assistant'&&<span className="create-avatar" aria-hidden="true">d.</span>}<p>{text}</p></div>}
function ChatHistory({onClose,children}:{onClose:()=>void;children:React.ReactNode}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const previous=document.activeElement as HTMLElement;ref.current?.showModal();return()=>{ref.current?.close();previous?.focus();};},[]);return <dialog className="conversation-history" ref={ref} aria-label="Conversation history" onCancel={e=>{e.preventDefault();onClose();}}>{children}</dialog>}
function ChatArtwork({businessId,projectId,revision}:{businessId:string;projectId:string;revision:string}){const [version,setVersion]=useState<any>(),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0);useEffect(()=>{let live=true;void api(`/api/v1/businesses/${businessId}/creative-projects/${projectId}`).then(r=>{if(live)setVersion(r.versions.find((v:any)=>v.id===revision));}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[businessId,projectId,revision,retry]);return <><Notice error={error}/>{!!error&&<button onClick={()=>{setError(undefined);setRetry(n=>n+1);}}>Reload image</button>}{version?<CreativeEditor businessId={businessId} design={version.design} onChange={()=>{}} readOnly previewOnly onExportReady={()=>{}}/>:<p role="status">Loading your saved creative…</p>}</>}
