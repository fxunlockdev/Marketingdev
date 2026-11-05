'use client';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {composeIdea,hasPromptTopic,libraryIdeas,type Idea} from './prompt-library';
import s from './prompt-suggestions.module.css';

type Props={brand:string;name:string;draft:string;format?:string;limit:number;insert:(text:string)=>void;focus:()=>void};
type Context={dismissed:boolean;context:string;preference_key:string};
type Result={id:string|null;status:string;idea:Idea|null};
export function PromptSuggestions({brand,name,draft,format='',limit,insert,focus}:Props){
 const endpoint='/api/v1/businesses/'+brand+'/create-chat/prompt-suggestions';
 const [context,setContext]=useState<Context>(),[dismissed,setDismissed]=useState(false),[inserted,setInserted]=useState(false);
 const [tailored,setTailored]=useState<{key:string;idea:Idea}>(),[preview,setPreview]=useState<{key:string;idea:Idea;text:string}>();
 const requestKey=JSON.stringify([brand,format,draft]);
 const hasTopic=hasPromptTopic(draft);
 const local=libraryIdeas(draft,context?.context??name,format);
 const sample=local[0]?.direction??'';
 const active=useRef(new Map<string,Promise<Result>>());
 useEffect(()=>{let live=true;
  void api<Context>(endpoint).then(value=>{
   if(!live)return;
   let hidden=value.dismissed;
   try{hidden=hidden||localStorage.getItem('desvio:no-prompt-ideas:'+value.preference_key)==='1';}catch{}
   setDismissed(hidden);
   if(hidden&&!value.dismissed)void api(endpoint+'/dismiss',{},'PUT').catch(()=>{});
   setContext(value);
  }).catch(()=>{});
  return ()=>{live=false;};
 },[endpoint]);
 useEffect(()=>{
  if(!draft.trim()){setPreview(undefined);return;}
  if(!hasTopic)return;
  if(dismissed||inserted||!context||draft.trim().length<5||draft.length>800||preview?.key===requestKey)return;
  let live=true,timer:ReturnType<typeof setTimeout>;
  let cooldowns=0;
  const receive=(result:Result,attempt:number)=>{
   if(!live)return;
   if(result.idea){setTailored({key:requestKey,idea:result.idea});return;}
   if(result.status==='cooldown'&&cooldowns<5){
    cooldowns++;
    active.current.delete(requestKey);
    timer=setTimeout(requestIdea,12000);
    return;
   }
   if(result.id&&['queued','running','retrying'].includes(result.status)&&attempt<16){
    timer=setTimeout(()=>void api<Result>(endpoint+'/'+result.id).then(r=>receive(r,attempt+1)).catch(()=>{}),Math.min(2400,600+attempt*180));
   }
  };
  function requestIdea(){
   let promise=active.current.get(requestKey);
   if(!promise){
    if(active.current.size>=12)active.current.delete(active.current.keys().next().value!);
    promise=api<Result>(endpoint,{draft,format,example:sample});
    active.current.set(requestKey,promise);
   }
   void promise.then(r=>receive(r,0)).catch(()=>{});
  }
  timer=setTimeout(requestIdea,650);
  return ()=>{live=false;clearTimeout(timer);};
 },[hasTopic,context,dismissed,inserted,draft,format,endpoint,sample,preview?.key,requestKey]);
 const choices=(tailored?.key===requestKey?[tailored.idea,...local.filter(i=>i.title!==tailored.idea.title)]:local).slice(0,2)
  .filter(i=>composeIdea(draft,i,name,format).length<=limit);
 const opened=preview?.key===requestKey?preview:undefined;
 function cancel(){setDismissed(true);try{if(context)localStorage.setItem('desvio:no-prompt-ideas:'+context.preference_key,'1');}catch{}void api(endpoint+'/dismiss',{},'PUT').catch(()=>{});focus();}
 if(!draft.trim()||!context||dismissed||inserted||(!choices.length&&!opened))return null;
 return <section className={s.ideas} aria-label="Prompt ideas" onKeyDown={e=>{if(e.key==='Escape'&&opened){e.preventDefault();cancel();}}}>
 <span className={s.label}>Prompt ideas</span><div className={s.choices}>{choices.map(idea=>{
  function open(){setPreview({key:requestKey,idea,text:composeIdea(draft,idea,name,format)});}
  return <button type="button" key={idea.title} aria-expanded={opened?.idea.title===idea.title} onPointerEnter={e=>{if(e.pointerType==='mouse')open();}} onClick={open}>{idea.title}<span aria-hidden="true">↗</span></button>;
 })}</div>
 {opened&&<div className={s.preview}><strong>{opened.idea.title}</strong><p>{opened.text}</p><div className={s.actions}><button type="button" onClick={cancel}>Cancel</button><button type="button" onClick={()=>{setInserted(true);insert(opened.text);focus();}}>Insert</button></div></div>}
 </section>;
}
