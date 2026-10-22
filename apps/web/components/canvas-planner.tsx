"use client";
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';
import {addDays,dayStart,localMinute} from '../../api/src/local-calendar';
export function CanvasPlanner({business}:{business:{id:string;role:string;has_approved_brand:boolean}}){
 const root=`/api/v1/businesses/${business.id}`;
 const [brief,setBrief]=useState(''),[days,setDays]=useState(30),[count,setCount]=useState(30),[start,setStart]=useState(''),[prefs,setPrefs]=useState<any>(),[jobs,setJobs]=useState<any[]>([]),[selected,setSelected]=useState(''),[plan,setPlan]=useState<any>(),[slots,setSlots]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[reload,setReload]=useState(0);
 const selectionTouched=useRef(false);
 const key=useRef<{body:string;id:string}|undefined>(undefined);useUnsavedChanges(!!brief||busy);
 useEffect(()=>{let active=true;void api(root+'/onboarding').then(p=>{if(active){setPrefs(p);setStart(localMinute(Date.now(),p.timezone).slice(0,10));}}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[root]);
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;const load=async()=>{try{const data=await api(root+'/content-plan/jobs');if(!active)return;setJobs(data.jobs);setSelected(s=>selectionTouched.current?s:data.jobs.find((j:any)=>j.output_plan_id)?.output_plan_id||'');if(data.jobs.some((j:any)=>['queued','running','retrying'].includes(j.status)))timer=setTimeout(load,2500);}catch(e){if(active)setError(e);}};void load();return()=>{active=false;clearTimeout(timer);};},[root,reload]);
 useEffect(()=>{let active=true;if(!selected){setPlan(undefined);setSlots([]);return;}setPlan(undefined);setSlots([]);void(async()=>{const p=await api(root+'/content-plans/'+selected);const q=new URLSearchParams({plan_id:p.id,start:dayStart(p.starts_on,p.timezone),end:dayStart(addDays(p.starts_on,p.duration_days),p.timezone)});const result=await api(root+'/content-plan?'+q);if(active){setPlan(p);setSlots(result.slots);}})().catch(e=>{if(active)setError(e);});return()=>{active=false;};},[root,selected,reload]);
 async function submit(){setBusy(true);setError(undefined);const body={brief,starts_on:start,duration_days:days,post_count:count};if(key.current?.body!==JSON.stringify(body))key.current={body:JSON.stringify(body),id:crypto.randomUUID()};try{await api(root+'/content-plan/generate',body,'POST',key.current.id);key.current=undefined;setBrief('');selectionTouched.current=false;setSelected('');setReload(n=>n+1);}catch(e){setError(e);}finally{setBusy(false);}}
 return <details className="v5-panel"><summary>Plan content in Canvas</summary><p>Ask for a launch sequence, a weekly theme or a daily post. Your approved brand guides the plan; every post stays a draft until reviewed.</p>
 {error!==undefined&&<Notice error={error}/>}
 {!business.has_approved_brand||prefs?.step!==3?<p><a href={`/b/${business.id}/onboarding`}>Confirm your brand and goals before planning.</a></p>:<form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||business.role==='viewer'}>
 <Field label="What should we plan?">{id=><textarea id={id} placeholder="Plan a week of helpful posts introducing our services…" value={brief} maxLength={2000} onChange={e=>setBrief(e.target.value)}/>}</Field>
 <div className="button-row">{[1,7,30].map(n=><button type="button" key={n} aria-pressed={days===n} onClick={()=>{setDays(n);setCount(n);}}>{n===1?'Daily':n===7?'Weekly':'30 days'}</button>)}</div>
 <Field label="Planning days">{id=><input id={id} type="number" min={1} max={90} required value={days} onChange={e=>{setDays(Number(e.target.value));setCount(Number(e.target.value));}}/>}</Field>
 <Field label="Number of posts">{id=><input id={id} type="number" min={1} max={90} required value={count} onChange={e=>setCount(Number(e.target.value))}/>}</Field>
 <Field label="Canvas plan starts on">{id=><input id={id} type="date" required min="2000-01-01" max="2100-12-01" value={start} onChange={e=>setStart(e.target.value)}/>}</Field>
 <p>{prefs.timezone} · {prefs.channels.join(', ')}</p><button type="submit" className="primary">{busy?'Saving request…':'Plan my content'}</button>
 </fieldset></form>}
 {jobs.filter(j=>!j.output_plan_id).slice(0,3).map(j=><p key={j.id} role="status">{['queued','running','retrying'].includes(j.status)?'Preparing your content plan…':j.status==='unknown'?'Planning needs reconciliation before another request.':`Planning ${j.status}. Your saved plans remain available.`}</p>)}
 {!!jobs.some(j=>j.output_plan_id)&&<Field label="Saved content plan">{id=><select id={id} value={selected} onChange={e=>{selectionTouched.current=true;setSelected(e.target.value);}}>{jobs.filter(j=>j.output_plan_id).map(j=><option key={j.id} value={j.output_plan_id}>{j.preferences.starts_on} · {j.duration_days??30} days · {j.post_count??30} posts</option>)}</select>}</Field>}
 {plan&&<section aria-label="Planned posts"><h3>{plan.title}</h3><p>{plan.strategy?.strategy}</p><a className="button" href={`/b/${business.id}/content-plan?start=${plan.starts_on}`}>Open this plan in calendar</a><ol>{slots.map(s=><li key={s.id}><strong>{new Date(s.planned_at).toLocaleDateString(undefined,{timeZone:plan.timezone,weekday:'short',month:'short',day:'numeric'})} · {s.channel} · Static post</strong><p>{s.brief}</p><p>{s.state.replaceAll('_',' ')}</p><a href={`/b/${business.id}/content-plan?start=${plan.starts_on}&slot=${s.id}`}>Edit or review this post</a></li>)}</ol></section>}
 </details>;
}
