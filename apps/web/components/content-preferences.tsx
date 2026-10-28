"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Field,Loading,Notice} from './primitives';
import './workspace-refinement.css';
import {TimeZoneSelect} from './time-zone-select';
import {confirmNavigation,useUnsavedChanges} from './unsaved';
type Preferences={revision:number;step:number;goal:string;timezone:string;cadence:number;channels:string[];must_avoid:string;business_stage:string;growth_expectation:string};
export function ContentPreferences({business}:{business:{id:string;name:string;role:string}}){
 const [value,setValue]=useState<Preferences>(),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false);
 const writable=['owner','admin','editor'].includes(business.role);
 const path=`/api/v1/businesses/${business.id}/onboarding`;
 useUnsavedChanges(dirty);
 async function load(){setBusy(true);setError(undefined);try{setValue(await api<Preferences>(path));setDirty(false);setSaved(false);}catch(e){setError(e);}finally{setBusy(false);}}
 useEffect(()=>{void load();},[path]);
 function change<K extends keyof Preferences>(key:K,next:Preferences[K]){setValue(v=>v?{...v,[key]:next}:v);setDirty(true);setSaved(false);}
 async function save(event:React.FormEvent){event.preventDefault();if(!value||!writable||busy)return;if(!value.channels.length){setError(new Error('Choose at least one preferred channel.'));return;}setBusy(true);setError(undefined);setSaved(false);try{
  const {revision,step,goal,timezone,cadence,channels,must_avoid,business_stage,growth_expectation}=value;
  setValue(await api<Preferences>(path,{revision,step,goal,timezone,cadence,channels,must_avoid,business_stage:business_stage??'',growth_expectation:growth_expectation??'',preferences_edited:true},'PATCH'));setDirty(false);setSaved(true);
 }catch(e){setError(e);}finally{setBusy(false);}}
 return <section className="content-preferences"><div className="v5-page-title"><p className="eyebrow">{business.name}</p><h1>Content Preferences</h1><p>Your defaults. Every new plan starts here.</p></div><Notice error={error}/>{!value?busy?<Loading/>:<button onClick={()=>void load()}>Try again</button>:<form onSubmit={save}>
 <fieldset disabled={busy||!writable}><legend className="sr-only">Content preferences</legend>
 <section className="preference-section"><div><span className="preference-step">01</span><h2>Your goal</h2><p>What should your content help you achieve?</p></div><div>
 <Field label="Primary goal">{id=><select id={id} value={value.goal} onChange={e=>change('goal',e.target.value)}><option value="awareness">Build awareness</option><option value="traffic">Bring people to my website</option><option value="leads">Get more enquiries</option><option value="sales">Grow sales</option></select>}</Field>
 <Field label="What would success look like?" hint="Optional — your goal for the next 90 days.">{(id,hint)=><textarea id={id} aria-describedby={hint} maxLength={600} value={value.growth_expectation??''} onChange={e=>change('growth_expectation',e.target.value)}/>}</Field></div></section>
 <section className="preference-section"><div><span className="preference-step">02</span><h2>Where and when</h2><p>Set defaults for new plans. Existing posts keep their schedule.</p></div><div><fieldset className="preference-channels preference-channel-cards"><legend>Preferred channels</legend>{[['instagram','Instagram'],['linkedin','LinkedIn'],['facebook','Facebook']].map(([key,label])=><label key={key} data-selected={value.channels.includes(key)}><input type="checkbox" checked={value.channels.includes(key)} onChange={e=>change('channels',e.target.checked?[...value.channels,key]:value.channels.filter(c=>c!==key))}/>{label}</label>)}</fieldset>
 <Field label="Posts per week">{id=><input id={id} type="number" required min={1} max={30} value={value.cadence} onChange={e=>change('cadence',Number(e.target.value))}/>}</Field>
 <Field label="Time zone">{id=><TimeZoneSelect id={id} disabled={busy||!writable} value={value.timezone} onChange={next=>change('timezone',next)}/>}</Field></div></section>
 <section className="preference-section"><div><span className="preference-step">03</span><h2>Keep it on brand</h2><p>Tell us what to leave out.</p></div><Field label="Topics or claims to avoid">{id=><textarea id={id} maxLength={2000} value={value.must_avoid} onChange={e=>change('must_avoid',e.target.value)} placeholder="Words, subjects, or claims you don’t want in your content."/>}</Field></section>
 </fieldset><div className="actions preference-save-bar"><span className="hint" role="status">{dirty?'Unsaved changes':saved?'All changes saved':'Your saved defaults'}</span>{writable?<><button className="primary" type="submit" disabled={busy||!dirty}>{busy?'Saving…':'Save preferences'}</button><button type="button" disabled={busy||!dirty} onClick={()=>{if(confirmNavigation())void load();}}>Discard changes</button></>:<p>You can view these preferences. Ask an editor to make changes.</p>}</div>{saved&&<p role="status">Preferences saved. New plans will use these choices.</p>}</form>}</section>;
}
