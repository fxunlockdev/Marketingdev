"use client";
import {CreativeBrief,type CreativeBriefValue} from "./creative-brief";
import {ActionButton} from "./design-system";
import {DesvioSelect,DesvioMultiSelect} from './desvio-select';
import {useEffect,useState} from 'react';
import {api} from './api';
import {Field,Loading,Notice} from './primitives';
import './workspace-refinement.css';
import {TimeZoneSelect} from './time-zone-select';
import {confirmNavigation,useUnsavedChanges} from './unsaved';
type Preferences={revision:number;step:number;goal:string;timezone:string;cadence:number;channels:string[];must_avoid:string;business_stage:string;growth_expectation:string;creative_brief?:CreativeBriefValue};
export function ContentPreferences({business}:{business:{id:string;name:string;role:string}}){
 const [value,setValue]=useState<Preferences>(),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false);
 const writable=['owner','admin','editor'].includes(business.role);
 const path=`/api/v1/businesses/${business.id}/onboarding`;
 useUnsavedChanges(dirty);
 async function load(){setBusy(true);setError(undefined);try{setValue(await api<Preferences>(path));setDirty(false);setSaved(false);}catch(e){setError(e);}finally{setBusy(false);}}
 useEffect(()=>{void load();},[path]);
 function change<K extends keyof Preferences>(key:K,next:Preferences[K]){setValue(v=>v?{...v,[key]:next}:v);setDirty(true);setSaved(false);}
 async function save(event:React.FormEvent){event.preventDefault();if(!value||!writable||busy)return;if(!value.channels.length){setError(new Error('Choose at least one preferred channel.'));return;}setBusy(true);setError(undefined);setSaved(false);try{
  const {revision,step,goal,timezone,cadence,channels,must_avoid,business_stage,growth_expectation,creative_brief}=value;
  setValue(await api<Preferences>(path,{revision,step,goal,timezone,cadence,channels,must_avoid,business_stage:business_stage??'',growth_expectation:growth_expectation??'',creative_brief:creative_brief??{},preferences_edited:true},'PATCH'));setDirty(false);setSaved(true);
 }catch(e){setError(e);}finally{setBusy(false);}}
 return <section className="content-preferences"><div className="v5-page-title"><p className="eyebrow">{business.name}</p><h1>Content Preferences</h1><p>Your defaults. Every new plan starts here.</p></div><Notice error={error}/>{!value?busy?<Loading/>:<ActionButton onClick={()=>void load()} label="Try again" />:<form onSubmit={save}>
 <fieldset disabled={busy||!writable}><legend className="sr-only">Content preferences</legend>
 <section className="preference-section"><div><span className="preference-step">01</span><h2>Your goal</h2><p>What should your content help you achieve?</p></div><div>
 <Field label="Primary goal">{id=><DesvioSelect id={id} value={value.goal} onChange={event=>change('goal',event.target.value)}>{[["awareness","Build awareness"],["traffic","Bring people to my website"],["leads","Get more enquiries"],["sales","Grow sales"]].map(([key,label])=><option key={key} value={key}>{label}</option>)}</DesvioSelect>}</Field>
 <Field label="What would success look like?" hint="Optional. Your goal for the next 90 days.">{(id,hint)=><textarea id={id} aria-describedby={hint} maxLength={600} value={value.growth_expectation??''} onChange={e=>change('growth_expectation',e.target.value)}/>}</Field></div></section>
 <section className="preference-section"><div><span className="preference-step">02</span><h2>Where and when</h2><p>Set defaults for new plans. Existing posts keep their schedule.</p></div><div><DesvioMultiSelect label="Preferred channels" value={value.channels} options={['instagram','linkedin','facebook'].map(value=>({value,label:value==='linkedin'?'LinkedIn':value==='instagram'?'Instagram':'Facebook'}))} onChange={next=>change('channels',next)} disabled={busy||!writable}/>
 <Field label="Posts per week">{id=><input id={id} type="number" required min={1} max={30} value={value.cadence} onChange={e=>change('cadence',Number(e.target.value))}/>}</Field>
 <Field label="Time zone">{id=><TimeZoneSelect id={id} disabled={busy||!writable} value={value.timezone} onChange={next=>change('timezone',next)}/>}</Field></div></section>
 <section className="preference-section"><div><span className="preference-step">03</span><h2>Keep it on brand</h2><p>Tell us what to leave out.</p></div><Field label="Topics or claims to avoid">{id=><textarea id={id} maxLength={2000} value={value.must_avoid} onChange={e=>change('must_avoid',e.target.value)} placeholder="Words, subjects, or claims you don’t want in your content."/>}</Field></section>
 <CreativeBrief value={value.creative_brief} onChange={next=>change("creative_brief",next)} disabled={busy||!writable}/>
 </fieldset><div className="actions preference-save-bar"><span className="hint" role="status">{dirty?'Unsaved changes':saved?'All changes saved':'Your saved defaults'}</span>{writable?<><ActionButton className="primary" type="submit" disabled={busy||!dirty} label={busy?'Saving…':'Save preferences'} /><ActionButton type="button" disabled={busy||!dirty} onClick={()=>{if(confirmNavigation())void load();}} label="Discard changes" /></>:<p>You can view these preferences. Ask an editor to make changes.</p>}</div>{saved&&<p role="status">Preferences saved. New plans will use these choices.</p>}</form>}</section>;
}
