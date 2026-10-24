"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {Field,Notice} from './primitives';
import {useUnsavedChanges} from './unsaved';
type Run={id:string;status:string;error_code:string|null;cancel_requested:boolean;project_id:string;thread_id:string;output_version_id:string|null;prompt:string;slide_count:string};
type Slide={parent_job_id:string;position:number;generation_status:string;export_status:string;project_id:string;output_version_id:string|null};
type State={runs:Run[];slides:Slide[]};
const active=(r:Run)=>['queued','running','retrying'].includes(r.status);
export function CarouselGeneration({businessId,canEdit,onOpen,onSlide}:{businessId:string;canEdit:boolean;onOpen:(id:string)=>Promise<void>;onSlide:(thread:string,project:string)=>void}){
 const root=`/api/v1/businesses/${businessId}/carousel-generations`,[data,setData]=useState<State>(),[prompt,setPrompt]=useState(''),[count,setCount]=useState(3),[channel,setChannel]=useState('linkedin'),[provider,setProvider]=useState('openai'),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const key=useRef(crypto.randomUUID()),lock=useRef(false);useUnsavedChanges(!!prompt||busy);
 const load=useCallback(async()=>setData(await api<State>(root)),[root]);
 useEffect(()=>{let alive=true;void api<State>(root).then(v=>{if(alive)setData(v);}).catch(e=>{if(alive)setError(e);});return()=>{alive=false;};},[root]);
 const running=data?.runs.some(active),held=data?.runs.some(r=>r.status==='unknown');
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>{if(!document.hidden)void load().catch(setError);},2500);return()=>clearInterval(timer);},[running,load]);
 function changed(){key.current=crypto.randomUUID();}
 async function generate(){if(lock.current)return;lock.current=true;setBusy(true);setError(undefined);try{await api(root,{prompt,slide_count:count,channel,size:'1024x1024',text_provider:provider},'POST',key.current);setPrompt('');changed();await load();}catch(e){setError(e);}finally{setBusy(false);lock.current=false;}}
 async function cancel(id:string){setBusy(true);setError(undefined);try{await api(`${root}/${id}/cancel`,{});await load();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section aria-label="Generate a carousel"><h3>Generate a carousel</h3><p>Describe your story. AI uses your approved brand knowledge to plan and create the slides together. Review the finished carousel before publishing.</p><Notice error={error}/>
 {canEdit&&<form onSubmit={e=>{e.preventDefault();void generate();}}><fieldset disabled={busy||running||held}><legend>Carousel brief</legend>
 <Field label="Carousel idea">{id=><textarea id={id} required maxLength={4000} value={prompt} onChange={e=>{setPrompt(e.target.value);changed();}}/>}</Field>
 <Field label="Number of carousel slides">{id=><input id={id} type="number" min={2} max={10} required value={count} onChange={e=>{setCount(Number(e.target.value));changed();}}/>}</Field>
 <Field label="Generate carousel for">{id=><select id={id} value={channel} onChange={e=>{setChannel(e.target.value);changed();}}><option value="linkedin">LinkedIn</option><option value="instagram">Instagram</option></select>}</Field>
 <Field label="Carousel planning model">{id=><select id={id} value={provider} onChange={e=>{setProvider(e.target.value);changed();}}><option value="openai">OpenAI GPT</option></select>}</Field>
 <p className="hint">Creates square images with OpenAI. Generation uses your configured allowance; no separate prompt approval is required for static images.</p><button type="submit" className="primary" disabled={!prompt.trim()||!data}>Generate carousel</button>
 </fieldset></form>}
 {running&&<p role="status">Your carousel is being prepared. You can leave this page and return later.</p>}{held&&<p role="status">A generation result needs reconciliation. Further generation is paused to prevent duplicate charges.</p>}
 <button type="button" disabled={busy} onClick={()=>{if(!document.hidden)void load().catch(setError);}}>Refresh carousel progress</button>
 {!data?<p role="status">Loading generation history…</p>:<ul>{data.runs.map(r=><li key={r.id}><h4>{r.prompt}</h4><p>{r.status==='succeeded'?'Ready for review':r.status==='unknown'?'Result needs reconciliation':r.status==='rejected'||r.status==='failed'?'Generation could not finish':r.cancel_requested?'Cancellation requested':r.status}</p>
 <ol>{data.slides.filter(s=>s.parent_job_id===r.id).map(s=><li key={s.position}>Slide {s.position+1} · {s.export_status==='succeeded'?'Saved final image':s.generation_status}{s.output_version_id&&<button type="button" disabled={busy} onClick={()=>onSlide(r.thread_id,s.project_id)}>Open generated slide {s.position+1}</button>}</li>)}</ol>
 {r.output_version_id&&<button type="button" disabled={busy} onClick={()=>void onOpen(r.project_id).catch(setError)}>Review generated carousel</button>}
 {canEdit&&active(r)&&<button type="button" disabled={busy||r.cancel_requested} onClick={()=>void cancel(r.id)}>Cancel carousel generation</button>}
 {['failed','rejected','canceled','unknown'].includes(r.status)&&<p className="hint">Completed slides remain available above. Nothing from this request has been approved for publishing.</p>}
 </li>)}</ul>}
 </section>;
}
