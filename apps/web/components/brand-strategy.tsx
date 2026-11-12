"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {Loading,Notice} from './primitives';
import {CreativeRecovery} from './creative-recovery';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {EmptyState} from './ui/empty-state';
import {StatusBadge} from './ui/status-badge';
import styles from './brand-strategy.module.css';

type Citation={fact_ids:string[];evidence_ids:string[];basis:'proven'|'unproven'};
type Persona=Citation&{id:string;name:string;life_situation:string;relationship_to_problem:string;why_this_brand:string};
type Pain=Citation&{id:string;persona_id:string;statement:string;anchor:boolean};
type Angle=Citation&{id:string;persona_id:string;pain_id:string;awareness:string;angle:string};
type Pillar=Citation&{id:string;name:string;purpose:string;persona_ids:string[]};
type Format={id:string;angle_id:string;format:string;rationale:string};
type Strategy={summary:string;personas:Persona[];pains:Pain[];angles:Angle[];formats:Format[];pillars:Pillar[];warnings:string[]};
type Version={id:string;version:number;status:'draft'|'approved';sha256:string;strategy:Strategy;created_at:string;approved_at:string|null};
type Run={id:string;status:string;error_code:string|null;created_at:string};
type State={strategies:Version[];jobs:Run[]};
export type StrategyBusiness={id:string;name:string;role:string};

const ACTIVE=new Set(['queued','running','retrying']);
const POLL_MS=4000;
const AWARENESS:Record<string,string>={unaware:'Unaware',problem_aware:'Problem aware',solution_aware:'Solution aware',product_aware:'Product aware',most_aware:'Most aware'};
const FORMAT:Record<string,string>={static:'Single image',carousel:'Carousel',story:'Story',reel:'Reel'};

/** Where an item comes from, in words. An unproven item is a hypothesis and says so. */
function Basis({item}:{item:Citation}){
 const facts=item.fact_ids.length,research=item.evidence_ids.length;
 const sources=[facts?`${facts} approved brand ${facts===1?'fact':'facts'}`:'',research?`${research} research ${research===1?'source':'sources'}`:''].filter(Boolean).join(' and ');
 return <p className={styles.basis}>
  {item.basis==='unproven'?<StatusBadge status="needs_attention" label="Unproven"/>:<StatusBadge status="approved" label="Supported"/>}
  <span>{item.basis==='unproven'?'A hypothesis to test, not a fact about your business.':`Cites ${sources}.`}</span>
 </p>;
}

function PersonaCard({persona,strategy}:{persona:Persona;strategy:Strategy}){
 const pains=strategy.pains.filter(p=>p.persona_id===persona.id),angles=strategy.angles.filter(a=>a.persona_id===persona.id);
 return <Card elevation="low" className={styles.persona}>
  <header className={styles.personaHead}><h3>{persona.name}</h3><Basis item={persona}/></header>
  <dl className={styles.facts}>
   <div><dt>Life situation</dt><dd>{persona.life_situation}</dd></div>
   <div><dt>Relationship to the problem</dt><dd>{persona.relationship_to_problem}</dd></div>
   <div><dt>Why this brand</dt><dd>{persona.why_this_brand}</dd></div>
  </dl>
  <section aria-label={`Pains for ${persona.name}`}><h4>Pains</h4><ul className={styles.list}>{pains.map(p=><li key={p.id}><span>{p.statement}{p.anchor&&<em className={styles.anchor}> Main pain</em>}</span><Basis item={p}/></li>)}</ul></section>
  <section aria-label={`Angles for ${persona.name}`}><h4>Angles</h4><ul className={styles.list}>{angles.map(a=>{const format=strategy.formats.find(f=>f.angle_id===a.id);return <li key={a.id}>
   <span><strong className={styles.awareness}>{AWARENESS[a.awareness]??a.awareness}</strong> {a.angle}</span>
   {format&&<span className={styles.format}>{FORMAT[format.format]??format.format}: {format.rationale}</span>}<Basis item={a}/>
  </li>;})}</ul></section>
 </Card>;
}

function StrategyView({version}:{version:Version}){
 const s=version.strategy;
 return <div className={styles.strategy}>
  <p className={styles.summary}>{s.summary}</p>
  {s.warnings.length>0&&<ul className={styles.warnings} aria-label="Notes from the strategist">{s.warnings.map(w=><li key={w}>{w}</li>)}</ul>}
  <section aria-labelledby="strategy-personas"><h2 id="strategy-personas">Who you are talking to</h2><div className={styles.personas}>{s.personas.map(p=><PersonaCard key={p.id} persona={p} strategy={s}/>)}</div></section>
  <section aria-labelledby="strategy-pillars"><h2 id="strategy-pillars">Content pillars</h2><ul className={styles.pillars}>{s.pillars.map(p=><li key={p.id}><Card tone="muted" className={styles.pillar}>
   <h3>{p.name}</h3><p>{p.purpose}</p><p className={styles.serves}>For {p.persona_ids.map(id=>s.personas.find(x=>x.id===id)?.name??id).join(', ')}</p><Basis item={p}/>
  </Card></li>)}</ul></section>
 </div>;
}

/** The business's brand strategy: read the latest version, ask for one, and approve exactly the version shown. */
export function BrandStrategy({business}:{business:StrategyBusiness}){
 const root=`/api/v1/businesses/${business.id}/brand-strategy`,reviewer=['owner','admin'].includes(business.role);
 const [state,setState]=useState<State>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState<'request'|'approve'>();
 const requestKey=useRef<string|undefined>(undefined);
 const load=useCallback(async()=>{try{setState(await api<State>(root));setError(undefined);}catch(e){setError(e);}},[root]);
 useEffect(()=>{void load();},[load]);
 const run=state?.jobs[0],active=!!run&&ACTIVE.has(run.status);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>void load(),POLL_MS);return ()=>clearInterval(timer);},[active,load]);
 async function request(){
  if(busy)return;setBusy('request');setError(undefined);
  // One key per press, kept until the server answers, so a retried click cannot start a second run.
  requestKey.current??=crypto.randomUUID();
  try{await api(root,{},'POST',requestKey.current);requestKey.current=undefined;await load();}
  catch(e){if(e instanceof ApiError&&e.status<500)requestKey.current=undefined;setError(e);}
  finally{setBusy(undefined);}
 }
 async function approve(version:Version){
  if(busy)return;setBusy('approve');setError(undefined);
  try{await api(`${root}/${version.id}/approve`,{sha256:version.sha256});await load();}catch(e){setError(e);await load();}finally{setBusy(undefined);}
 }
 if(!state)return <section className={styles.screen}><Notice error={error}/>{!error&&<div role="status" aria-label="Loading brand strategy"><Loading/></div>}</section>;
 const latest=state.strategies[0],approved=state.strategies.find(v=>v.status==='approved');
 return <section className={styles.screen} aria-labelledby="brand-strategy-title">
  <header className={styles.heading}>
   <div><p className={styles.eyebrow}>{business.name}</p><h1 id="brand-strategy-title">Strategy</h1>
    <p className={styles.lede}>Who your posts speak to, what they struggle with, and the angles and pillars your plans are built from. Your monthly plan uses the approved version.</p></div>
   {reviewer&&<Button variant={latest?'secondary':'primary'} loading={busy==='request'} disabled={active||!!busy} onClick={()=>void request()}>{latest?'Build a new version':'Build my strategy'}</Button>}
  </header>
  <Notice error={error}/>
  {run&&active&&<Card tone="muted" className={styles.progress} role="status"><StatusBadge status="in_progress" label="Building your strategy"/><p>Reading your brand profile and research. This usually takes a few minutes; you can leave this page.</p></Card>}
  {run?.status==='unknown'&&<Card tone="muted" className={styles.progress}><StatusBadge status="needs_attention" label="Result uncertain"/><p>We could not confirm whether the last strategy run finished.</p><CreativeRecovery businessId={business.id} jobId={run.id} kind="request" disabled={!reviewer} onRecovered={load}/></Card>}
  {run&&['failed','rejected'].includes(run.status)&&!latest&&<Card tone="muted" className={styles.progress}><StatusBadge status="failed" label="Not built"/><p>The last strategy run did not finish. {reviewer?'You can try again.':'Ask an owner or admin to try again.'}</p></Card>}
  {!latest?(!active&&run?.status!=='unknown'&&<EmptyState title="No strategy yet" description={reviewer?'Build one from your approved brand profile and research. You review it before any plan uses it.':'An owner or admin can build the strategy for this business.'}/>):<>
   <div className={styles.versionBar}>
    <StatusBadge status={latest.status==='approved'?'approved':'in_review'} label={latest.status==='approved'?`Version ${latest.version} approved`:`Version ${latest.version} waiting for approval`}/>
    {latest.status==='draft'&&approved&&<span className={styles.note}>Plans keep using version {approved.version} until you approve this one.</span>}
    {latest.status==='draft'&&(reviewer?<Button variant="primary" loading={busy==='approve'} disabled={!!busy} onClick={()=>void approve(latest)}>Approve version {latest.version}</Button>:<span className={styles.note}>An owner or admin approves the strategy.</span>)}
   </div>
   <StrategyView version={latest}/>
  </>}
 </section>;
}
