"use client";
import {CreativeRecovery} from './creative-recovery';
import {DesvioSelect} from './desvio-select';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api,ApiError} from './api';
import {useAnyUnsavedChanges} from './unsaved';
import {Notice} from './primitives';
import {CreativeProject} from './canvas';
import {SavedChatImage} from './saved-chat-image';
import {PromptSuggestions} from './prompt-suggestions';
import {ChatStartMenu} from './chat-start-menu';
import {ChatCarousel,ChatVideo} from './chat-media';
import {GenerationProgress} from './generation-progress';
import {BrandProfileGate,isBrandProfileError} from './brand-profile-gate';
import {ChatFormatPreview,creationLabels,isVisualKind} from './chat-format-preview';
import './create-chat.css';
import './conversation-chat.css';
type Business={id:string;name:string;role:string;has_approved_brand:boolean;organization_id?:string};
const pending=(s:string)=>['queued','running','retrying'].includes(s);
export function ConversationChat({business}:{business:Business}){
 const router=useRouter(),root=`/api/v1/businesses/${business.id}`;
 const [bootAttempt,setBootAttempt]=useState(0),[bootError,setBootError]=useState<unknown>(),[loadError,setLoadError]=useState<unknown>(),[historyError,setHistoryError]=useState<unknown>();
 const [userTyped,setUserTyped]=useState(false);
 const [selection,setSelection]=useState(''),[briefing,setBriefing]=useState(false);
 const [initializing,setInitializing]=useState(true),[options,setOptions]=useState(false),[aspect,setAspect]=useState(''),[overlay,setOverlay]=useState(''),[channel,setChannel]=useState(''),[displayed,setDisplayed]=useState('');
 const [id,setId]=useState(''),[data,setData]=useState<any>(),[canvas,setCanvas]=useState<any>(),[text,setText]=useState(''),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[history,setHistory]=useState(false),[search,setSearch]=useState(''),[items,setItems]=useState<any[]>([]),[refresh,setRefresh]=useState(0),[editor,setEditor]=useState(false),[dirty,setDirty]=useState(false);
 const unsaved=useAnyUnsavedChanges();
 const [videoChatTarget,setVideoChatTarget]=useState<HTMLDivElement|null>(null);
 const lock=useRef(false),request=useRef<{key:string;body:any}|null>(null),started=useRef(false),bootReady=useRef(false),log=useRef<HTMLDivElement>(null),composer=useRef<HTMLTextAreaElement>(null);
 const writable=['owner','admin','editor'].includes(business.role),last=data?.turns?.at(-1),working=initializing||!!bootError||busy||last?.action_status==='queued'||pending(last?.status)||canvas?.runs?.some((r:any)=>pending(r.status))||canvas?.planning_runs?.some((r:any)=>pending(r.status))||data?.carousel_runs?.some((r:any)=>pending(r.status)),uncertain=last?.status==='unknown'||canvas?.runs?.some((r:any)=>r.status==='unknown')||data?.carousel_runs?.some((r:any)=>r.status==='unknown');
 const carouselTurn=data?.turns?.findLast((t:any)=>t.output?.action==='carousel'),carouselRun=data?.carousel_runs?.find((r:any)=>r.id===carouselTurn?.action_result?.id),videoTurn=data?.turns?.findLast((t:any)=>t.output?.action==='video');
 const mediaAction=data?.turns?.findLast((t:any)=>['image','edit_image','carousel','video'].includes(t.output?.action))?.output?.action;
 const latestProject=canvas?.projects?.find((p:any)=>p.latest_version_id&&!data?.carousel_slides?.some((slide:any)=>slide.project_id===p.id)),latestRun=canvas?.runs?.[0];
 const imageTurn=data?.turns?.findLast((t:any)=>['image','edit_image'].includes(t.output?.action)),currentRun=canvas?.runs?.find((r:any)=>r.id===imageTurn?.action_result?.id);
 const completed=currentRun?.output_version_id?(displayed===latestProject?.latest_version_id?5:4):currentRun?.image_received?3:currentRun?.brief_ready?2:imageTurn?1:0;
 const imageWorking=!!imageTurn&&(imageTurn.action_status==='queued'||pending(currentRun?.status));
 function leaveEdits(){return !(dirty||unsaved||text.trim())||window.confirm('Leave your unsaved edits? Your sent conversation is saved.');}
 function navigate(url:string){if(!busy&&leaveEdits())router.push(url);}
 function resetOptions(){setUserTyped(false);setOptions(false);setAspect('');setOverlay('');setChannel('');setDisplayed('');}
 function choose(value:string,format='',askTopic=false){resetOptions();setBriefing(askTopic);setSelection(isVisualKind(format)?format:'');setDirty(false);setId(value);setData(undefined);setCanvas(undefined);setEditor(false);setHistory(false);setError(undefined);setLoadError(undefined);setText('');window.history.replaceState(window.history.state,'',`/b/${business.id}/create?conversation=${value}${isVisualKind(format)?'&format='+format:''}${askTopic?'&brief=1':''}`);}
 async function deliver(envelope:{key:string;body:any}){
  // Keep this exact envelope until the server confirms both acceptance and acknowledgement.
  request.current=envelope;
  await api(root+'/create-chat/outbox',envelope,'PUT');
  const r=await api(root+'/create-chat/messages',envelope.body,'POST',envelope.key);
  window.history.replaceState(window.history.state,'',`/b/${business.id}/create?conversation=${r.conversation_id}`);
  setId(r.conversation_id);setBriefing(false);
  await api(root+'/create-chat/outbox/'+encodeURIComponent(envelope.key)+'/acknowledge',{});
  request.current=null;setText('');setAspect('');setOverlay('');setChannel('');setOptions(false);setRefresh(n=>n+1);
 }
 async function send(message=text){if(lock.current||!bootReady.current||dirty||unsaved||!message.trim()||!writable)return;lock.current=true;setBusy(true);setError(undefined);
  try{await deliver(request.current??{key:crypto.randomUUID(),body:{conversation_id:id||null,message:[...((!id||briefing)&&isVisualKind(selection)?[`Create ${selection==='image'?'an':'a'} ${selection==='post'?'post':selection==='story'?'story image':selection}.`]:[]),message.trim(),...([aspect,overlay,channel].filter(Boolean).length?['Creation preferences: '+[aspect,overlay,channel].filter(Boolean).join('; ')]:[])].join('\n')}});}
  catch(e){setError(e);}finally{setBusy(false);lock.current=false;}
 }
 useEffect(()=>{if(started.current)return;started.current=true;void(async()=>{
  try{setBootError(undefined);const saved=await api(root+'/create-chat/outbox');bootReady.current=true;
   if(saved.request){setBusy(true);lock.current=true;await deliver(saved.request);return;}
   const q=new URLSearchParams(location.search),conversation=q.get('conversation');if(conversation){choose(conversation,q.get('format')??'',q.get('brief')==='1');return;}
   if(q.get('history'))setHistory(true);
   // A completed initial prompt is replaced by its conversation URL. Never replay it on refresh.
   if(q.get('q'))await send(q.get('q')!);
   else if(q.get('start')){const start=q.get('start')!;if(isVisualKind(start))setSelection(start);else setText(start==='campaign'?'Create a campaign about ':'');}
  }catch(e){if(request.current)setError(e);else setBootError(e);}finally{lock.current=false;setBusy(false);setInitializing(false);}
 })();},[bootAttempt]);
 useEffect(()=>{if(!history)return;setHistoryError(undefined);let live=true;const timer=setTimeout(()=>void api(root+'/create-chat/history?q='+encodeURIComponent(search)).then(r=>{if(live){setItems(r.conversations);setHistoryError(undefined);}}).catch(e=>{if(live)setHistoryError(e);}),200);return()=>{live=false;clearTimeout(timer);};},[root,history,search,refresh]);
 useEffect(()=>{if(!id)return;let live=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const [d,c]=await Promise.all([api(root+'/create-chat/conversations/'+id),api(root+'/canvas/threads/'+id)]);if(!live)return;setData(d);setCanvas(c);setLoadError(undefined);

   }catch(e){if(live)setLoadError(e);}if(live)timer=setTimeout(poll,2500);};void poll();return()=>{live=false;clearTimeout(timer);};},[root,id,refresh,writable]);
 useEffect(()=>{const el=log.current;if(!el)return;if(!id&&!data?.turns?.length){el.scrollTop=0;return;}let follow=true;const bottom=()=>{if(follow)el.scrollTop=el.scrollHeight;};const scroll=()=>{follow=el.scrollHeight-el.scrollTop-el.clientHeight<48;};bottom();el.addEventListener('scroll',scroll,{passive:true});const observer=new ResizeObserver(bottom);observer.observe(el);for(const child of Array.from(el.children))observer.observe(child);return()=>{observer.disconnect();el.removeEventListener('scroll',scroll);};},[id,data?.turns?.length,data?.saved_images?.length,last?.status]);

 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(text.trim()||dirty||unsaved||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[text,dirty,unsaved,busy]);
 function fresh(){if(request.current||busy||initializing)return;if((text.trim()||dirty||unsaved)&&!window.confirm('Leave your unsaved edits and start a new conversation?'))return;resetOptions();setBriefing(false);setSelection('');setId('');setData(undefined);setCanvas(undefined);setText('');setError(undefined);setLoadError(undefined);setEditor(false);setDirty(false);router.replace(`/b/${business.id}/create`);}
 const timeline=[...(data?.turns??[]).map((turn:any)=>({kind:'turn',item:turn})),...(data?.saved_images??[]).map((image:any)=>({kind:'image',item:image}))].sort((a,b)=>new Date(a.item.created_at).getTime()-new Date(b.item.created_at).getTime()||a.item.id.localeCompare(b.item.id));
 const action=last?.output?.action;
 const atStart=!id&&!data?.turns?.length&&!selection;
 const pickingTopic=!!selection&&(!id||briefing);
 const savedKind=(data?.turns?.[0]?.message??'').match(/^Create (?:a|an) (post|image|carousel|reel|video|story)\b/i)?.[1]?.toLowerCase()??'';
 const formatKind=mediaAction==='video'?(videoTurn?.output?.placement==='reel'?'reel':videoTurn?.output?.placement==='story'?'story':'video'):mediaAction==='carousel'?'carousel':mediaAction==='image'?(imageTurn?.output?.placement==='story'?'story':'image'):selection||savedKind;
 const formatLabel=creationLabels[formatKind]??'';
 function startCreation(kind:string){
  if(kind==='strategy'){navigate(`/b/${business.id}/create?guided=1&start=${kind}`);return;}
  resetOptions();setBriefing(isVisualKind(kind));setSelection(isVisualKind(kind)?kind:'');setText(kind==='campaign'?'Create a campaign about ':'');
  if(isVisualKind(kind))window.history.replaceState(window.history.state,'',id?`/b/${business.id}/create?conversation=${id}&format=${kind}&brief=1`:`/b/${business.id}/create?start=${kind}`);
  composer.current?.focus();
 }

 return <section className={`create-chat-screen conversation-screen${atStart?' is-start':pickingTopic?' is-topic':''}`} aria-label="Create with Desvio">
 <div className="create-chat-panel"><header><span className="create-chat-wordmark"><img src="/site-brand/brand/desvio-black-lime.svg" alt="Desvio" width="130" height="32" /></span>{formatLabel&&<span className="create-mode">{formatLabel}</span>}<button className={atStart||formatLabel?"chat-start-history":""} aria-label="Conversation history" disabled={busy||initializing||!!request.current} onClick={()=>setHistory(true)}>{atStart||formatLabel?<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/></svg>:"History"}</button><button onClick={fresh} disabled={busy||initializing||!!request.current}><svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>Start over</button><button aria-label="Close chat" disabled={busy} onClick={()=>navigate(`/b/${business.id}`)}>×</button></header>
 <progress value={pending(last?.status)?undefined:mediaAction==='carousel'?(data?.carousel_slides??[]).filter((s:any)=>s.parent_job_id===carouselRun?.id&&s.export_status==='succeeded').length:completed} max={mediaAction==='carousel'?Number(carouselRun?.slide_count??3):5} aria-label={pending(last?.status)?"Understanding your request":mediaAction==='carousel'?"Saved carousel slides":mediaAction==='video'?"Creation progress":"Completed image workflow steps"}/><div className="create-chat-log" ref={log} role="log" aria-live="polite">
 {!atStart&&!pickingTopic&&!data?.turns?.length&&<Message role="assistant" text="What are we making today?"/>}

 {writable && [...new Set([currentRun,carouselRun].filter(r=>r?.status==='unknown').map(r=>r.id).concat(last?.action_status==='failed'&&data?.blocking_creative?[data.blocking_creative]:[]))].map(jobId=><CreativeRecovery key={jobId} businessId={business.id} jobId={jobId} disabled={busy||dirty} onRecovered={async()=>{setRefresh(n=>n+1);}}/>)}
 {timeline.map(({kind,item:t})=>kind==='image'?<SavedChatImage key={t.id} businessId={business.id} image={t}/>:<div key={t.id}><Message role="user" text={t.message}/>{t.output&&<><Message role="assistant" text={t.output.action==='video'&&/starting image in the canvas|script there/i.test(t.output.reply)?'Let’s bring your idea to life. Choose a starting image here, then select Generate video.':t.output.reply.replace(/\u2014/g,', ')} sources={t.sources??[]}/>{t.sources?.length>0&&<p className="conversation-sources">From saved history: {t.sources.map((source:any)=><button key={source.id} onClick={()=>{if(busy||!leaveEdits())return;if(source.kind==='conversation')choose(source.id);else router.push(`/b/${business.id}/content-plan?plan=${source.id}`);}}>{chatDisplayText(source.title)}</button>)}</p>}</>}{pending(t.status)&&<Message role="assistant" text="Thinking through your request…"/>}{['unknown','failed','rejected','canceled'].includes(t.status)&&<p className="conversation-problem" role="status">{t.status==='unknown'?'The provider response could not be confirmed. Your message is saved; another paid request will not be sent automatically.':'This request could not finish. Your message is saved. You can send a revised request.'}</p>}</div>)}
 {pickingTopic&&<><Message role="user" text={creationLabels[selection]}/><Message role="assistant" text={`${selection==='image'?'An':'A'} ${selection==='post'?'post':selection}, coming right up. It stays a draft until you approve it.`}/><Message role="assistant" text={`What should this ${selection==='story'?'story':selection} be about?`}/></>}
 {(atStart||action==='answer'&&!formatKind)&&!working&&<ChatStartMenu disabled={busy||initializing} onCreate={startCreation} onNavigate={path=>navigate(path.startsWith('/')?path:`/b/${business.id}/${path}`)}/>}


 {!!error&&<section className="conversation-recovery" aria-label="Message recovery">{isBrandProfileError(error)?<BrandProfileGate business={business} compact onApproved={()=>{setError(undefined);if(request.current)void send(request.current.body.message);}}/>:<Notice error={error}/>}<div className="conversation-recovery-actions">{!!error&&<button disabled={busy} onClick={()=>{setError(undefined);if(request.current)void send(request.current.body.message);else setRefresh(n=>n+1);}}>{request.current?'Retry saved request':'Refresh conversation'}</button>}
 {!!error&&!!request.current&&<button disabled={busy} onClick={async()=>{const saved=request.current;if(!saved)return;setBusy(true);try{await api(root+'/create-chat/outbox/'+encodeURIComponent(saved.key)+'/discard',{});request.current=null;setText(saved.body.message);setError(undefined);}catch(e){setError(e);}finally{setBusy(false);}}}>Return to editing unsent message</button>}
</div></section>}
 {!!bootError&&<section className="conversation-recovery" aria-label="Chat connection"><Notice error={bootError}/><button disabled={initializing} onClick={()=>{started.current=false;setInitializing(true);setBootAttempt(n=>n+1);}}>Reconnect chat</button></section>}
 {!!loadError&&<section className="conversation-recovery" aria-label="Conversation connection">{loadError instanceof ApiError&&loadError.status===0?<p role="status">Connection interrupted. We’re reconnecting to your saved conversation.</p>:<Notice error={loadError}/>}<button onClick={()=>setRefresh(n=>n+1)}>Reconnect now</button></section>}

 <div ref={setVideoChatTarget} className="chat-video-conversation-mount"/>
 </div>
 {(!atStart||options)&&!['video','reel'].includes(formatKind)&&<div className="conversation-options"><button type="button" aria-expanded={options} onClick={()=>setOptions(v=>!v)}>Creation options {options?'−':'+'}</button>{options&&<div className="conversation-option-fields"><label>Format<DesvioSelect aria-label="Format" value={aspect} disabled={working||!!latestProject} onChange={e=>setAspect(e.target.value)}><option value="">Let Desvio choose</option><option>Square image</option><option>Portrait image</option><option>Landscape image</option></DesvioSelect></label><label>Image text<DesvioSelect aria-label="Image text" value={overlay} disabled={working} onChange={e=>setOverlay(e.target.value)}><option value="">Follow my message</option><option>No text on the image</option><option>A short readable headline</option></DesvioSelect></label><label>Channel<DesvioSelect aria-label="Channel" value={channel} disabled={working} onChange={e=>setChannel(e.target.value)}><option value="">Let Desvio choose</option><option>Instagram</option><option>Facebook</option><option>LinkedIn</option></DesvioSelect></label></div>}</div>}
 {last?.action_status==='failed'&&<div className="conversation-problem" role="status"><p>Your creative could not start{last.action_message?`: ${last.action_message}`:'.'} Your request is saved.</p><button disabled={busy} onClick={async()=>{setBusy(true);try{await api(root+`/create-chat/turns/${last.id}/execute`,{});setRefresh(n=>n+1);}catch(e){setError(e);}finally{setBusy(false);}}}>Try starting this creative again</button></div>}
 {!business.has_approved_brand&&writable&&!error&&<BrandProfileGate business={business}/>}
 {(dirty||unsaved)&&<p role="status">Finish your current edits before sending another instruction.</p>}
 {(atStart||pickingTopic)&&!history&&writable&&!working&&!request.current&&business.has_approved_brand&&<PromptSuggestions key={business.id} brand={business.id} name={business.name} draft={userTyped?text:''} format={selection} limit={3800} insert={setText} focus={()=>composer.current?.focus()}/>}
 <form className="create-composer text-enabled" onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={composer} aria-label="Message Desvio" placeholder={pickingTopic?`What should this ${selection} be about?`:latestProject?'Tell me what to change…':'Describe the image, carousel or video you want to create…'} maxLength={3800} rows={atStart||pickingTopic?1:2} value={text} disabled={!writable||busy||initializing} onChange={e=>{setUserTyped(true);setText(e.target.value);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!working&&!uncertain)void send();}}}/><button aria-label="Send message" disabled={!writable||!text.trim()||working||uncertain||dirty||unsaved} type="submit">→</button></form>{!atStart&&!pickingTopic&&<span className="create-save-state" role="status">{busy?'Saving your message…':id?'Conversation saved · Available in History':'Your conversations are saved when you send'}</span>}
 </div>
 <div className="create-live-canvas"><header><span><i aria-hidden="true"/>Live canvas</span>{!atStart&&<span>{business.name}{formatLabel?` · ${formatLabel}`:action&&action!=='answer'?` · ${action.replace('_',' ')}`:''}</span>}{latestProject&&!['carousel','video'].includes(mediaAction)&&<button className="conversation-post-details" disabled={busy} onClick={()=>navigate(`/b/${business.id}/campaign-post?project=${latestProject.id}`)}>Post details</button>}<button disabled={busy} onClick={()=>navigate(`/b/${business.id}`)}>Close</button></header><div className="create-preview-area conversation-preview">
 {imageWorking&&['image','edit_image'].includes(mediaAction)&&<GenerationProgress media="image" run={currentRun??{id:imageTurn.id,status:'queued',created_at:imageTurn.created_at}} stage={currentRun?.image_received?2:currentRun?.brief_ready?1:0} timing={canvas?.image_timing} disconnected={!!loadError}/>}
 {imageWorking&&!latestProject&&['image','edit_image'].includes(mediaAction)?null:pickingTopic||!latestProject&&!carouselRun&&mediaAction!=='video'&&isVisualKind(formatKind)?<ChatFormatPreview kind={formatKind} brand={business.name} shape={aspect.startsWith('Portrait')?'portrait':aspect.startsWith('Landscape')?'landscape':currentRun?.size==='1024x1536'?'portrait':currentRun?.size==='1536x1024'?'landscape':undefined} status={uncertain?'Needs attention':imageWorking?'Creating':working?'Preparing':latestRun&&['failed','rejected','canceled'].includes(latestRun.status)?'Generation stopped':'Draft'}/>:mediaAction==='carousel'&&carouselRun?<ChatCarousel key={carouselRun.id} business={business} run={carouselRun} slides={(data.carousel_slides??[]).filter((s:any)=>s.parent_job_id===carouselRun.id)} onDirty={setDirty} onRefresh={()=>setRefresh(n=>n+1)}/>:mediaAction==='video'&&videoTurn&&id?<ChatVideo key={videoTurn.id} business={business} threadId={id} turn={videoTurn} chatTarget={videoChatTarget}/>:latestProject?<section className="conversation-artwork is-inline" aria-label="Your creative"><CreativeProject business={{...business,organization_id:business.organization_id??''}} projectId={latestProject.id} refresh={latestProject.latest_version_id} onDirty={setDirty} onDisplayed={setDisplayed} onSaved={()=>setRefresh(n=>n+1)} editingDisabled={!!working} onAsk={message=>{if(!working&&!uncertain)void send(message);}} chatLayout canvasDetails={<><span>{formatLabel||'Image'}</span><span>{currentRun?.channel??'Standalone'}</span></>}/></section>:!data?.turns?.length?<div className="create-empty"><div className="create-paper-tiles" aria-hidden="true"><span>Image</span><span>Carousel</span><span>Video</span></div><h1>Your idea lands <em>here.</em></h1><p>Pick something to create in the chat. I’ll build it live on this canvas while we talk.</p></div>:<section className="conversation-image-placeholder" aria-label="Image preview"><div><span className="conversation-placeholder-title">{imageWorking?'Creating your image':working?'Understanding your idea':'Your next creative'}</span><span className="conversation-placeholder-lines" aria-hidden="true"/><strong>{business.name}</strong></div>{<p role="status">{uncertain?'This request needs attention. Your conversation is saved.':latestRun&&!pending(latestRun.status)&&latestRun.status!=='succeeded'?`Image ${latestRun.status}. Your conversation is saved.`:working?'Reading your direction…':'Tell me your idea in the chat to begin.'}</p>}</section>}
 {(!latestProject&&!formatKind&&!['carousel','video'].includes(mediaAction)&&data?.turns?.length>0)&&<div className="conversation-canvas-strip" aria-label="Creative details"><span>{currentRun?.format==='static'?'Image':action==='campaign'?'Content plan':'Creative'}</span><span>{currentRun?.size==='1024x1536'?'Portrait':currentRun?.size==='1536x1024'?'Landscape':currentRun?.size==='1024x1024'?'Square':'Format'}</span><span>{currentRun?.channel??'Channel'}</span><strong>{imageWorking?'Creating':latestProject?'Draft':'Your idea'}</strong></div>}
 {latestProject&&latestRun&&pending(latestRun.status)&&<p className="conversation-progress" role="status">Creating your next version. Your previous image stays available.</p>}
 {latestProject&&latestRun&&['failed','rejected','unknown','canceled'].includes(latestRun.status)&&<p className="conversation-problem">Your last image request {latestRun.status==='unknown'?'needs reconciliation':latestRun.status}. The previous version is preserved.</p>}
 {canvas?.planning_runs?.some((r:any)=>pending(r.status))&&<p className="conversation-progress" role="status">Planning your content. Your conversation and progress are saved.</p>}
 {canvas?.planning_runs?.filter((r:any)=>r.output_plan_id).map((r:any)=><a className="conversation-campaign" key={r.id} href={`/b/${business.id}/content-plan?plan=${r.output_plan_id}`}>Review your calendar →</a>)}
 {action==='strategy'&&<a className="conversation-campaign" href={`/b/${business.id}/create?guided=1&start=strategy`}>Choose and authorize your recurring strategy →</a>}

 </div></div>
 {history&&<ChatHistory onClose={()=>setHistory(false)}><header><h2>Conversation history</h2><button aria-label="Close history" onClick={()=>setHistory(false)}>×</button></header><label htmlFor="chat-history-search">Search this business’s conversations</label><input id="chat-history-search" placeholder="Try a post or an idea…" value={search} onChange={e=>setSearch(e.target.value)}/><Notice error={historyError}/>{!!historyError&&<button onClick={()=>setRefresh(n=>n+1)}>Reload history</button>}<ul>{items.map(c=><li key={c.id}><button onClick={()=>{if(busy||!leaveEdits())return;choose(c.id);}}><strong>{chatDisplayText(c.title)}</strong><span>{new Date(c.updated_at).toLocaleDateString()}</span></button></li>)}</ul>{!historyError&&!items.length&&<p>No saved conversations found.</p>}<p>Only your conversations for {business.name} appear here.</p></ChatHistory>}
 </section>;
}
function Message({role,text,sources=[]}:{role:string;text:string;sources?:{id:string}[]}){
 // Verified history links below the message replace internal citation identifiers.
 const display=sources.reduce((value,source)=>value.replaceAll(` [${source.id}]`,'').replaceAll(`[${source.id}]`,''),text);
 return <div className={`create-message ${role}`}>{role==='assistant'&&<span className="create-avatar" aria-hidden="true">d.</span>}<p>{chatDisplayText(display)}</p></div>}
function ChatHistory({onClose,children}:{onClose:()=>void;children:React.ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{
  const dialog=ref.current,previous=document.activeElement as HTMLElement;
  dialog?.showModal();
  dialog?.querySelector<HTMLInputElement>('input')?.focus();
  return()=>{dialog?.close();if(previous?.isConnected)previous.focus();};
 },[]);
 return <dialog className="conversation-history" ref={ref} aria-label="Conversation history" onCancel={e=>{e.preventDefault();onClose();}}>{children}</dialog>;
}



// Older hosted verification chats included a correlation marker in their prompt.
// Keep the saved transcript intact; customer-facing labels omit that marker only.
function chatDisplayText(text:string){return text.replace(/^TEST\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\s*/i,'');}
