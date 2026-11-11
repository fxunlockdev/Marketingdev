"use client";
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {PromptSuggestions} from './prompt-suggestions';
import {AppLink} from './app-link';
import s from './home-create.module.css';
const icons={spark:'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',target:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',arrow:'M5 12h14M13 6l6 6-6 6'};
function Icon({path}:{path:string}){return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg>}
const tiles=[['post','Post','An image, carousel, video or story','var(--brand-wash)',icons.spark],['campaign','Plan my content','Review concepts and your monthly calendar','var(--brand-paper)',icons.layers],['strategy','Review posts','Approve assets or ask for changes','#e8edda',icons.target]];
const quick=[['reel','Reel','#e0dacb','M4 4h16v16H4zM10 9l5 3-5 3z'],['video','Video','var(--brand-paper)','M3 6h13v12H3zM16 10l5-3v10l-5-3z'],['carousel','Carousel','var(--brand-accent)','M7 5h10v14H7zM3 7v10M21 7v10'],['story','Story','#e8edda','M7 2h10v20H7zM10 5h4'],['review','Approve posts','var(--brand-accent)','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM9 12l2 2 4-4'],['publishing','Publish a post','#e8edda','M22 2 11 13M22 2l-7 20-4-9-9-4z'],['connections','Connect an account','#e0dacb','M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z'],['team','Invite a teammate','#e8edda','M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],['insights','Check results','var(--brand-paper)','M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3']];
export function HomeCreate({business,name}:{business:{id:string;name:string;role?:string;has_approved_brand:boolean};name?:string}){
 const router=useRouter(),[q,setQ]=useState(''),[draft,setDraft]=useState<string|null>(null),[recent,setRecent]=useState<any[]>([]);
 const input=useRef<HTMLInputElement>(null);
 const root=`/b/${business.id}`;
 useEffect(()=>{let active=true;void api(`/api/v1/businesses/${business.id}/create-chat/draft`).then(r=>{if(active)setDraft(r.draft?.snapshot?.mode??null);}).catch(()=>{});return()=>{active=false;};},[business.id]);
 useEffect(()=>{let active=true;void api(`/api/v1/businesses/${business.id}/create-chat/history`).then(r=>{if(active)setRecent(r.conversations.slice(0,3));}).catch(()=>{});return()=>{active=false;};},[business.id]);
 function open(params:Record<string,string>={}){router.push(`${root}/create?${new URLSearchParams({...params,from:root+'/overview'})}`);}
 return <section className={s.hero} aria-label="Create with Desvio">
 <div className={s.circles} aria-hidden="true"><i/><i/><i/></div>
 <div className={s.greeting}><span>{new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date())}</span><h2>Welcome back{name?`, ${name.split(' ')[0]}`:''}</h2></div>
 <div className={s.bubble}><span aria-hidden="true">d<b>.</b></span><p>What are we making today? Ask me, or pick a starting point.</p></div>
 <form className={s.composer} onSubmit={e=>{e.preventDefault();open(q.trim()?{q:q.trim()}:{});}}><Icon path={icons.spark}/><input ref={input} aria-label="Ask Desvio" placeholder="Describe an image, carousel or video…" maxLength={1200} value={q} onChange={e=>setQ(e.target.value)}/><button type="submit">Create <Icon path={icons.arrow}/></button></form>
 {business.has_approved_brand&&business.role!=='viewer'&&business.role!=='reviewer'&&<PromptSuggestions key={business.id} brand={business.id} name={business.name} draft={q} limit={1200} insert={value=>setQ(value.replaceAll('\n',' '))} focus={()=>input.current?.focus()}/>}
 <div className={s.tiles}>{tiles.map(([mode,title,desc,bg,path])=><button key={mode} style={{background:bg}} onClick={()=>mode==='campaign'?router.push(`${root}/monthly-planning`):mode==='strategy'?router.push(`${root}/review`):open({start:mode})}><span className={s.tileIcon}><Icon path={path}/></span><span><strong>{title}</strong><small>{desc}</small></span></button>)}</div>
 {draft&&<button className={s.resume} onClick={()=>open({resume:'1'})}>● Resume your {draft} <Icon path={icons.arrow}/></button>}
 {recent.length>0&&<div className={s.recent}><span>Recent conversations</span>{recent.map(c=><button key={c.id} onClick={()=>open({conversation:c.id})}>{c.title}</button>)}<button onClick={()=>open({history:'1'})}>View history →</button></div>}
 <div className={s.quick}>{quick.map(([key,label,bg,path])=><button key={key} onClick={()=>['reel','video','carousel','story'].includes(key)?open({start:key}):router.push(`${root}/${key}`)}><span style={{background:bg}}><Icon path={path}/></span>{label}</button>)}</div>

 {!business.has_approved_brand&&<div className={s.brand}><p><strong>Start with your brand.</strong> Review the extracted details so every new creative starts with approved brand knowledge.</p><AppLink href={`${root}/onboarding`}>Finish brand setup</AppLink></div>}
 </section>;
}
