"use client";
import {CreativeRecovery} from './creative-recovery';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {api} from './api';
import {Field,Loading,Notice} from './primitives';
import {DesvioSelect} from './desvio-select';
import {AppLink} from './app-link';
import {useUnsavedChanges} from './unsaved';
import {GuidedMoodboard} from './guided-moodboard';
import styles from './guided-business.module.css';
import {OnboardingQuestions,OnboardingFiles,onboardingSteps} from './onboarding-questions';
import type {GuidedBrief,ResearchSuggestions} from '../../api/src/guided-campaign-contracts';
/** JSON with object keys sorted: the database stores the brief as jsonb, which reorders keys, so plain
 * JSON.stringify would report a saved brief as changed. */
function stableJSON(value:unknown):string{return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);}
type Brief=GuidedBrief;
type Direction={summary:string;rationale:string;palette:{role:string;hex:string}[];heading_font:string;body_font:string;voice:string;imagery:string;pillars:string[];essential_questions:string[]};
type EarlyResearch={prefill_job_id?:string|null;prefill_status?:string|null;prefill_error?:string|null;prefill_website?:string|null;early_analysis_job_id?:string|null;early_analysis_status?:string|null;early_analysis_current?:boolean};
type StageState='skipped'|'waiting'|'running'|'done'|'failed'|'unknown';
type Progress={website:StageState;market:StageState;analysis:StageState};
const ACTIVE_STATES=['queued','running','retrying'];
const STAGES:{key:keyof Progress;running:string;done:string}[]=[
 {key:'website',running:'Reading your website…',done:'Read your website'},
 {key:'market',running:'Researching your market and competitors…',done:'Researched your market and competitors'},
 {key:'analysis',running:'Shaping your creative direction…',done:'Ready'},
];
const STATE_LABEL:Record<StageState,string>={waiting:'Up next',running:'In progress',done:'Done',skipped:'Skipped',failed:'Didn’t finish',unknown:'Needs a check'};
/** Research stages exactly as the server reports them; a skipped website step is not shown. */
function ResearchStages({progress}:{progress:Progress}){
 return <ol className={styles.stages}>{STAGES.filter(s=>!(s.key==='website'&&progress.website==='skipped')).map(s=>{const state=progress[s.key];
  return <li key={s.key} data-state={state}><span className={styles.marker} aria-hidden="true"/><span>{state==='done'?s.done:s.running}</span><small>{STATE_LABEL[state]}</small></li>;})}</ol>;
}
type Saved=EarlyResearch&{progress?:Progress;error_code?:string|null;analysis_error?:string|null;suggestions?:ResearchSuggestions;onboarding?:{social_profile_limit:number;channels:string[]};can_use_saved_answers?:boolean;answers_locked?:boolean;revision:number;step:number;brief:Brief;research_job_id:string|null;analysis_job_id?:string|null;status?:string;analysis_status?:string;result?:{business_direction?:Direction};analysis_result?:{business_direction?:Direction}};
const questions=onboardingSteps;
export function GuidedBusinessBrief({business,planning=false,accountEmail}:{accountEmail?:string;planning?:boolean;business:{id:string;organization_id:string;name:string;website:string|null;role?:string}}){
 const router=useRouter();
 const root=`/api/v1/businesses/${business.id}/guided-brief`;
 const [saved,setSaved]=useState<Saved>(),[brief,setBrief]=useState<Brief>(),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0);
 const fallbackKey=useRef<string|null>(null);
 const requestKey=useRef<string|null>(null),dirty=!!brief&&!!saved&&stableJSON(brief)!==stableJSON(saved.brief);
 useUnsavedChanges(dirty);
 useEffect(()=>{let live=true;api<Saved>(root).then(value=>{if(live){setSaved(value);setBrief(value.brief);setStep(value.step);}}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[root,retry]);
 const status=saved?.status==='unknown'?'unknown':saved?.analysis_status??saved?.status;
 const pending=!!status&&['queued','running','retrying'].includes(status),unknown=status==='unknown';
 const notConfigured=/NOT_CONFIGURED|APPROVAL_REQUIRED|GRANT_REQUIRED/.test(`${saved?.error_code??''} ${saved?.analysis_error??''}`);
 useEffect(()=>{if(!pending&&!unknown)return;let live=true;const timer=setInterval(()=>{if(document.hidden)return;api<Saved>(root).then(value=>{if(live){setSaved(value);setError(undefined);}}).catch(e=>{if(live)setError(e);});},5000);return()=>{live=false;clearInterval(timer);};},[pending,unknown,root]);
 // Early research runs while the owner keeps answering. Poll it quietly and take only its
 // status and suggestions, so the answers being typed are never replaced.
 const early=saved?.prefill_status,earlyAnalysis=saved?.early_analysis_current?saved.early_analysis_status:null;
 const earlyActive=(!!early&&ACTIVE_STATES.includes(early))||(!!earlyAnalysis&&ACTIVE_STATES.includes(earlyAnalysis));
 useEffect(()=>{if(!earlyActive)return;let live=true;const timer=setInterval(()=>{if(document.hidden)return;api<Saved>(root).then(value=>{if(live)setSaved(s=>s?{...s,prefill_job_id:value.prefill_job_id,prefill_status:value.prefill_status,prefill_error:value.prefill_error,prefill_website:value.prefill_website,early_analysis_job_id:value.early_analysis_job_id,early_analysis_status:value.early_analysis_status,early_analysis_current:value.early_analysis_current,progress:value.progress,suggestions:value.suggestions}:s);}).catch(()=>{/* A missed poll is retried on the next tick; the questionnaire keeps working. */});},5000);return()=>{live=false;clearInterval(timer);};},[earlyActive,root]);
 const change=(key:keyof Brief,value:string)=>setBrief(b=>b?{...b,[key]:value}:b);
 // Moving between steps brings the new step's question into view and gives it focus, instead of leaving the
 // customer at the bottom of the previous step. The first load keeps the page where it is.
 const shownStep=useRef<number|null>(null);
 useEffect(()=>{
  if(!saved)return;
  if(shownStep.current===null||shownStep.current===step){shownStep.current=step;return;}
  shownStep.current=step;
  const heading=document.getElementById('brief-question');if(!heading)return;
  heading.setAttribute('tabindex','-1');
  heading.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  heading.focus({preventScroll:true});
 },[step,saved]);
 // The server returns the brief as stored (normalised). Keep the page's copy in step with it, unless the customer
 // edited while the save was in flight, so a saved brief is never reported as "unsaved answers".
 function adoptSaved(sent:Brief,stored:Brief){setBrief(current=>current===sent?stored:current);}
 async function save(next?:number,leave=false){if(!brief||!saved)return;const sent=brief;setBusy(true);setError(undefined);try{const value=await api<{revision:number;step:number;brief:Brief}&EarlyResearch>(root,{revision:saved.revision,brief,step:next??step},'PATCH');adoptSaved(sent,value.brief);setSaved({...saved,...value,...(dirty?{research_job_id:null,status:undefined,analysis_status:undefined,result:undefined,analysis_result:undefined}:{})});requestKey.current=null;if(next!==undefined)setStep(next);if(leave)router.push(`/b/${business.id}/overview`);}catch(e){setError(e);}finally{setBusy(false);}}
 async function research(useSavedAnswers=false){if(!brief||!saved)return;const sent=brief;setBusy(true);setError(undefined);try{const value=await api<{revision:number;step:number;brief:Brief}>(root,{revision:saved.revision,brief,step},'PATCH');adoptSaved(sent,value.brief);setSaved({...saved,...value});const key=useSavedAnswers?fallbackKey:requestKey;key.current??=crypto.randomUUID();await api(`${root}/research`,{revision:value.revision,...(useSavedAnswers?{use_saved_answers:true}:{})},'POST',key.current);setSaved(await api<Saved>(root));key.current=null;}catch(e){setError(e);}finally{setBusy(false);}}
 if(!brief||!saved)return <><Notice error={error}/>{error?<button onClick={()=>setRetry(v=>v+1)}>Try again</button>:<Loading/>}</>;
 const direction=saved.analysis_result?.business_direction??saved.result?.business_direction;
 if(planning&&direction&&!direction.essential_questions.length)return <GuidedMoodboard business={business} revision={saved.revision} brief={saved.brief} planning/>;
 return <div className={styles.wrapper}><header><p className="eyebrow">{business.name}</p><h1>{direction?'Your creative direction':'Let’s get to know your business'}</h1><p>{direction?'From your business story to content that feels like you.':'Five short steps. We’ll use your answers to research your business and recommend a creative direction.'}</p></header><Notice error={error}/>
  <details open={!direction} className={styles.questions}><summary>Your business answers</summary><section className={styles.card} aria-labelledby="brief-question"><p className={styles.step}>Step {step+1} of 5 · {questions[step]}</p>
   <fieldset disabled={busy||pending||unknown||saved.answers_locked}><legend className="sr-only">{questions[step]}</legend>
    <OnboardingQuestions researching={!!early&&ACTIVE_STATES.includes(early)} suggestions={saved.suggestions} channels={saved.onboarding?.channels??[]} accountEmail={accountEmail} brief={brief} step={step} onChange={setBrief} onStep={next=>void save(next)} business={business} disabled={busy||pending||unknown||!!saved.answers_locked}/>
   </fieldset>
   {step===3&&!saved.answers_locked&&<OnboardingFiles business={business}/>}
   {saved.answers_locked&&<p className="hint">These answers are saved with your mood board. Use mood board feedback to refine your creative direction.</p>}<div className={styles.actions}><button disabled={busy||pending||unknown||step===0} onClick={()=>void save(step-1)}>Back</button><button disabled={busy||pending||unknown||saved.answers_locked} onClick={()=>void save(undefined,true)}>Save for later</button>{step<4?<button className="primary" disabled={busy||pending||unknown||(step===0&&!brief.offering.trim())||(step===1&&!brief.audience.trim())} onClick={()=>void save(step+1)}>Continue</button>:<button className="primary" disabled={busy||pending||unknown||!brief.offering.trim()||!brief.audience.trim()||saved.answers_locked||(!dirty&&!!direction)} onClick={()=>void research()}>{busy?'Saving…':pending?'Researching…':'Send my brief'}</button>}</div>
   {step===4&&!direction&&!pending&&!unknown&&!dirty&&!!earlyAnalysis&&(earlyAnalysis==='succeeded'||ACTIVE_STATES.includes(earlyAnalysis))&&<div className={styles.early} role="status">{earlyAnalysis==='succeeded'?<p><strong>Your research is ready.</strong> Send your brief to see it straight away.</p>:<><p><strong>We’ve already started researching your business.</strong> Send your brief whenever you’re ready; it picks up where the research is.</p>{saved.progress&&<ResearchStages progress={saved.progress}/>}</>}</div>}
   <p className="hint" role="status">{dirty?'You have unsaved answers.':saved.revision?'Your answers are saved. You can return here anytime.':'Your answers will be saved when you continue.'}</p>
  </section></details>
  {pending&&<section className={styles.card} role="status"><h2>Learning about your business</h2><p>Your research continues if you leave this page. We’ll keep the findings here for you.</p>{saved.progress?<ResearchStages progress={saved.progress}/>:<Loading/>}</section>}
  {early==='unknown'&&saved.prefill_job_id&&!unknown&&<section className={styles.card}><h2>Your website check needs a decision</h2><p>We couldn’t confirm whether our early look at your website finished. Your answers are saved and you can keep going. Before we research again, confirm you want to stop waiting for that check.</p><CreativeRecovery kind="request" businessId={business.id} jobId={saved.prefill_job_id} onRecovered={async()=>{setSaved(await api<Saved>(root));}}/></section>}
  {unknown&&<section className={styles.card}><h2>Your research needs a check</h2><p>We couldn’t confirm the result. Your answers are saved. We won’t start another paid request while this one is unresolved.</p>{(saved.analysis_status==='unknown'?saved.analysis_job_id:saved.research_job_id)&&<CreativeRecovery kind="request" businessId={business.id} jobId={(saved.analysis_status==='unknown'?saved.analysis_job_id:saved.research_job_id)!} onRecovered={async()=>{setSaved(await api<Saved>(root));}}/>}<AppLink href={`/b/${business.id}/onboarding`}>Open saved research →</AppLink></section>}
  {status&&['failed','rejected','canceled'].includes(status)&&<section className={styles.card}><h2>Research didn’t finish</h2><p>{notConfigured?'Research isn’t switched on for this business yet. Ask your workspace owner to enable AI research, then try again. Your answers are saved.':saved.can_use_saved_answers?'We couldn’t read your website. You can try again, or we can recommend a direction using your saved answers and available business information. You’ll review it before approving.':'Your answers are safe and nothing was charged for the step that failed. You can run the research again.'}</p>{(!saved.can_use_saved_answers||notConfigured)&&<button className="primary" disabled={busy||dirty} onClick={()=>void research(false)}>{busy?'Starting…':'Try research again'}</button>}{!saved.can_use_saved_answers&&dirty&&<p className="hint">Save your edited answers before trying again.</p>}{saved.can_use_saved_answers&&!notConfigured&&<button className="primary" disabled={busy||dirty} onClick={()=>void research(true)}>{busy?'Preparing…':'Continue with my answers'}</button>}{saved.can_use_saved_answers&&!notConfigured&&<button disabled={busy||dirty} onClick={()=>void research(false)}>Try research again</button>}{saved.can_use_saved_answers&&dirty&&<p className="hint">Save your edited answers before continuing.</p>}<AppLink href={`/b/${business.id}/onboarding`}>Review research →</AppLink></section>}
  {direction&&<details className={styles.card} open={direction.essential_questions.length>0}><summary>What we learned about your business</summary><section><p className="eyebrow">Proposed direction</p><h2>What we learned</h2><p>{direction.summary}</p><p>{direction.rationale}</p><div className={styles.palette}>{direction.palette.map(c=><div key={c.role}><span style={{background:c.hex}} aria-hidden="true"/><strong>{c.role}</strong><small>{c.hex}</small></div>)}</div><p><strong>Heading font:</strong> {direction.heading_font} · <strong>Body font:</strong> {direction.body_font}</p><p><strong>Voice:</strong> {direction.voice}</p><p><strong>Imagery:</strong> {direction.imagery}</p><ul>{direction.pillars.map(p=><li key={p}>{p}</li>)}</ul>{direction.essential_questions.length>0&&<><h3>A few details to clarify</h3><ul>{direction.essential_questions.map(q=><li key={q}>{q}</li>)}</ul></>}<p className="hint">These are suggestions, not approved brand rules or generated previews.</p><AppLink className="button" href={`/b/${business.id}/onboarding`}>Review researched brand facts →</AppLink></section></details>}
  {direction&&!direction.essential_questions.length&&<GuidedMoodboard business={business} revision={saved.revision} brief={saved.brief}/>}
 </div>;
}
