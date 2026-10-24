import {PostizError} from './postiz-client.js';
export type PostMetrics={state:'available'|'unavailable'|'missing';series:{label:string;points:{date:string;value:number}[]}[]};
const invalid=():never=>{throw new PostizError('POSTIZ_ANALYTICS_INVALID');};
/** Preserve provider observations; never infer zeros, daily deltas or growth. */
export function postMetrics(value:unknown):PostMetrics{
 if(value&&typeof value==='object'&&!Array.isArray(value)&&(value as any).missing===true&&Object.keys(value).length===1)return {state:'missing',series:[]};
 if(!Array.isArray(value)||value.length>30)return invalid();
 const names=new Set<string>();const series=value.map(raw=>{
  if(!raw||typeof raw!=='object'||typeof raw.label!=='string'||!/^[\p{L}\p{N} %()_/-]{1,80}$/u.test(raw.label)||names.has(raw.label.toLowerCase())||!Array.isArray(raw.data)||raw.data.length>366)invalid();names.add(raw.label.toLowerCase());
  const dates=new Set<string>();const points=raw.data.map((p:any)=>{
   if(!p||typeof p.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date||dates.has(p.date))invalid();dates.add(p.date);
   if(typeof p.total!=='number'&&(typeof p.total!=='string'||!/^\d{1,15}(\.\d{1,9})?$/.test(p.total)))invalid();const number=Number(p.total);if(!Number.isFinite(number)||number<0||number>Number.MAX_SAFE_INTEGER)invalid();return {date:p.date,value:number};
  });return {label:raw.label,points:points.sort((a:any,b:any)=>a.date.localeCompare(b.date))};
 }).filter(s=>s.points.length);
 return {state:series.length?'available':'unavailable',series};
}
