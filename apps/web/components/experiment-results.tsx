"use client";
import {useRef,useState} from 'react';
import {api} from './api';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';
export type Experiment={id:string;lesson_revision:number;starts_on:string;ends_on:string;method:string;outcome:string;results:string;created_at:string};
const labels:Record<string,string>={supported:'Supported in this test',not_supported:'Not supported in this test',inconclusive:'Inconclusive'};
export function ExperimentResults({records,canRecord,revision,url,onSaved}:{records:Experiment[];canRecord:boolean;revision:number;url:string;onSaved:()=>Promise<void>}){
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[method,setMethod]=useState(''),[results,setResults]=useState(''),[outcome,setOutcome]=useState('inconclusive'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[notice,setNotice]=useState('');const key=useRef(crypto.randomUUID()),lock=useRef(false);
 useUnsavedChanges(!!start||!!end||!!method||!!results||busy);
 function changed(){setConfirmed(false);key.current=crypto.randomUUID();setNotice('');}
 async function save(){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);try{await api(url,{revision,starts_on:start,ends_on:end,method,outcome,results,confirmed},'POST',key.current);await onSaved();setStart('');setEnd('');setMethod('');setResults('');setOutcome('inconclusive');setConfirmed(false);key.current=crypto.randomUUID();setNotice('Experiment report saved. The hypothesis remains unproven.');}catch(e){setError(e);}finally{lock.current=false;setBusy(false);}}
 return <details><summary>Experiment results ({records.length})</summary><p>Record what your team tested and observed. These are human-reported results, not independently verified conclusions. They do not change brand facts or generation instructions.</p>
 {records.length===0?<p>No experiment results recorded yet.</p>:<ol>{records.map(r=><li key={r.id}><h4>{labels[r.outcome]??r.outcome} · team report</h4><p>{r.starts_on} to {r.ends_on} · hypothesis revision {r.lesson_revision}</p><p><strong>Method:</strong> {r.method}</p><p><strong>Results and limitations:</strong> {r.results}</p><p>Recorded {new Date(r.created_at).toLocaleString()}</p></li>)}</ol>}
 <Notice error={error}/>{notice&&<p role="status">{notice}</p>}
 {canRecord&&records.length<20&&<form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy}><legend>Record a completed experiment</legend>
 <Field label="Experiment start date">{id=><input id={id} type="date" required max={end||new Date().toISOString().slice(0,10)} value={start} onChange={e=>{setStart(e.target.value);changed();}}/>}</Field>
 <Field label="Experiment end date">{id=><input id={id} type="date" required min={start||undefined} max={new Date().toISOString().slice(0,10)} value={end} onChange={e=>{setEnd(e.target.value);changed();}}/>}</Field>
 <Field label="Test method" hint="Describe the variants, audience, measurement window and how you compared them.">{(id,hint)=><textarea id={id} aria-describedby={hint} required minLength={10} maxLength={2000} value={method} onChange={e=>{setMethod(e.target.value);changed();}}/>}</Field>
 <Field label="Your conclusion">{id=><select id={id} value={outcome} onChange={e=>{setOutcome(e.target.value);changed();}}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>}</Field>
 <Field label="Results and limitations" hint="Include actual measurements, sample sizes, confounding factors and references your team can check.">{(id,hint)=><textarea id={id} aria-describedby={hint} required minLength={10} maxLength={4000} value={results} onChange={e=>{setResults(e.target.value);changed();}}/>}</Field>
 <label className="learning-consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I confirm these are our reported observations, not proof of causation.</label>
 <p className="hint">Confirm your report to save. Saved records cannot be edited; add a new record explaining any correction. Retire the hypothesis separately if it should no longer guide generation.</p><button disabled={!confirmed} type="submit">{busy?'Saving report…':'Save experiment report'}</button>
 </fieldset></form>}
 </details>;
}
