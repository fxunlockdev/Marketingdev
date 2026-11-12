/** Wall-clock helpers for publishing in the business's time zone, and honest metric labels. */
/** "2027-01-02T09:30" for `iso` as seen in `zone`, the value a datetime-local input expects. */
export function localInput(iso:string,zone:string):string{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function formatWhen(iso:string,zone:string):string{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone:zone}).format(new Date(iso));}
export const metricName=(key:string):string=>key.replaceAll('_',' ');
export const metricValue=(value:number):string=>new Intl.NumberFormat().format(value);
/** Lifetime totals, most useful first; only values the provider actually reported. */
const ORDER=['views','impressions','reach','likes','reactions','comments','shares','saves','clicks'];
export function orderedMetrics(metrics:Record<string,number>):[string,number][]{
 const rank=(k:string)=>{const i=ORDER.indexOf(k.toLowerCase());return i<0?ORDER.length:i;};
 return Object.entries(metrics).filter(([,v])=>Number.isFinite(v)&&v>=0).sort((a,b)=>rank(a[0])-rank(b[0])||a[0].localeCompare(b[0]));
}
export const FORMAT_LABEL:Record<string,string>={static:'Static post',carousel:'Carousel',video:'Reel / video',story:'Story',ad:'Ad'};
export function formatLabel(format:string|undefined,placement?:string):string{
 if(placement==='story')return 'Story';if(placement==='reel')return 'Reel';return FORMAT_LABEL[format??'static']??'Post';
}
