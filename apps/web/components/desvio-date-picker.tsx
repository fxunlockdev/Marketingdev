"use client";
import {useEffect,useRef,useState} from 'react';
import {localMinute,localCandidates} from '../../api/src/local-calendar';
import './desvio-date-picker.css';
const iso=(date:Date)=>date.toISOString().slice(0,10);
const parsed=(day:string)=>new Date(day+'T12:00:00Z');
const validDay=(day:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(parsed(day).getTime())&&iso(parsed(day))===day;
export function DesvioDatePicker({value,onChange,time=false,timezone,label,disabled=false}:{value:string;onChange:(v:string)=>void;time?:boolean;timezone:string;label:string;disabled?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null);
 return <><button ref={trigger} type="button" className="desvio-date-trigger" aria-label={label} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(true)}>{validDay(value.slice(0,10))?`${new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(parsed(value.slice(0,10)))}${time?' · '+value.slice(11):''}`:time?'Choose date & time':'Choose date'}<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v16H4zM8 2v6M16 2v6M4 11h16"/></svg></button>{open&&<DateDialog value={value} time={time} timezone={timezone} label={label} onClose={()=>{setOpen(false);trigger.current?.focus();}} onApply={v=>{onChange(v);setOpen(false);trigger.current?.focus();}}/>}</>;
}
function DateDialog({value,time,timezone,label,onClose,onApply}:{value:string;time:boolean;timezone:string;label:string;onClose:()=>void;onApply:(v:string)=>void}){
 const today=localMinute(Date.now(),timezone).slice(0,10),initial=validDay(value.slice(0,10))?value.slice(0,10):today;
 const [day,setDay]=useState(initial),[focus,setFocus]=useState(initial),[month,setMonth]=useState(initial.slice(0,7)),[hour,setHour]=useState(value.slice(11,13)||'09'),[minute,setMinute]=useState(value.slice(14,16)||'00'),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),grid=useRef<HTMLDivElement>(null),moving=useRef(false);
 useEffect(()=>{dialog.current?.showModal();grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();return()=>dialog.current?.close();},[]);
 useEffect(()=>{if(moving.current){grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();moving.current=false;}},[focus,month]);
 const first=parsed(month+'-01'),start=new Date(first.getTime()-first.getUTCDay()*86400000),dates=Array.from({length:42},(_,i)=>iso(new Date(start.getTime()+i*86400000)));
 function navigate(delta:number){const date=parsed(month+'-01');date.setUTCMonth(date.getUTCMonth()+delta);const next=iso(date);if(next<'2000-01-01'||next>'2100-12-01')return;setMonth(next.slice(0,7));setFocus(next);}
 function move(e:React.KeyboardEvent<HTMLButtonElement>,date:string){const d=parsed(date),delta=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-d.getUTCDay(),End:6-d.getUTCDay()} as Record<string,number>)[e.key];if(delta!==undefined){e.preventDefault();d.setUTCDate(d.getUTCDate()+delta);}else if(['PageUp','PageDown'].includes(e.key)){e.preventDefault();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+(e.key==='PageUp'?-1:1));}else return;const next=iso(d);if(next<'2000-01-01'||next>'2100-12-31')return;moving.current=true;setFocus(next);setMonth(next.slice(0,7));}
 function apply(){const h=Number(hour),m=Number(minute);if(time&&(!/^\d{1,2}$/.test(hour)||!/^\d{1,2}$/.test(minute)||h<0||h>23||m<0||m>59)){setError('Enter an hour from 0–23 and a minute from 0–59.');return;}const result=day+(time?'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'):'');if(time&&localCandidates(result,timezone).length!==1){setError('This time is skipped or repeated when the clocks change. Choose another time.');return;}onApply(result);}
 return <dialog className="desvio-date-dialog" ref={dialog} aria-label={label} onKeyDown={e=>{if(e.key==='Escape')e.stopPropagation();}} onCancel={e=>{e.preventDefault();e.stopPropagation();onClose();}}>
 <header><h2>{time?'When should it go live?':'Choose a date'}</h2><button type="button" aria-label="Close date picker" onClick={onClose}>×</button></header><p className="desvio-date-zone">Time zone · {timezone.replaceAll('_',' ')}</p>
 <div className="desvio-date-month"><button type="button" aria-label="Previous month" onClick={()=>navigate(-1)}>‹</button><strong aria-live="polite">{new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric',timeZone:'UTC'}).format(first)}</strong><button type="button" aria-label="Next month" onClick={()=>navigate(1)}>›</button></div>
 <div className="desvio-date-week" aria-hidden="true">{['S','M','T','W','T','F','S'].map((v,i)=><span key={i}>{v}</span>)}</div>
 <div className="desvio-date-grid" ref={grid} role="group" aria-label="Calendar dates">{dates.map(date=><button type="button" key={date} data-date={date} tabIndex={date===focus?0:-1} aria-pressed={day===date} aria-current={date===today?'date':undefined} aria-label={new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(parsed(date))} className={date.slice(0,7)!==month?'outside':''} onFocus={()=>setFocus(date)} onKeyDown={e=>move(e,date)} onClick={()=>{setDay(date);setFocus(date);setMonth(date.slice(0,7));setError('');}}>{Number(date.slice(8))}</button>)}</div>
 {time&&<div className="desvio-date-time"><span>Time · 24-hour</span><label>Hour<input aria-describedby={error?'desvio-date-error':undefined} inputMode="numeric" maxLength={2} value={hour} onChange={e=>setHour(e.target.value)}/></label><span>:</span><label>Minute<input aria-describedby={error?'desvio-date-error':undefined} inputMode="numeric" maxLength={2} value={minute} onChange={e=>setMinute(e.target.value)}/></label></div>}
 {error&&<p id="desvio-date-error" role="alert">{error}</p>}
 <footer><button type="button" onClick={()=>{setDay(today);setMonth(today.slice(0,7));setFocus(today);setError('');}}>Today</button><button type="button" className="desvio-date-apply" onClick={apply}>Use {time?'date & time':'this date'}</button></footer>
 </dialog>;
}
