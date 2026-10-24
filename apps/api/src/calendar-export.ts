/** Portable calendar snapshots. Export never schedules or approves a post. */
export type CalendarExportSlot = {
 id:string; revision:number; planned_at:string|Date; channel:string; format:string;
 state:string; brief:string; hook?:string|null; caption?:string|null; timezone:string;
};
const escapeText=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
function fold(line:string):string {
 let out='',part='',bytes=0;
 for(const character of line){const size=new TextEncoder().encode(character).length;if(bytes+size>75){out+=part+'\r\n';part=' ';bytes=1;}part+=character;bytes+=size;}
 return out+part;
}
const timestamp=(value:string|Date)=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))throw new Error('Invalid calendar timestamp');return d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');};
export function calendarExport(slots:CalendarExportSlot[],format:'csv'|'ics',generatedAt=new Date()):{content:string;content_type:string;extension:string} {
 if(slots.length>10000)throw new Error('Calendar export is too large');
 if(format==='csv'){
  // Quoting alone does not prevent spreadsheet formula execution.
  const cell=(v:unknown)=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['Post ID','Revision','Planned UTC','Timezone','Channel','Format','Review state','Hook','Brief','Caption'],...slots.map(s=>[s.id,s.revision,new Date(s.planned_at).toISOString(),s.timezone,s.channel,s.format,s.state,s.hook,s.brief,s.caption])];
  return {content:'\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n',content_type:'text/csv;charset=utf-8',extension:'csv'};
 }
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Desvio//Content Plan//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
 for(const s of slots){
  if(!/^[a-f0-9-]{36}$/i.test(s.id)||!Number.isSafeInteger(s.revision)||s.revision<1)throw new Error('Invalid saved calendar record');
  lines.push('BEGIN:VEVENT',`UID:${s.id}@desvio`, `SEQUENCE:${s.revision}`,`DTSTAMP:${timestamp(generatedAt)}`,`DTSTART:${timestamp(s.planned_at)}`,
   `SUMMARY:${escapeText(`${s.channel} · ${s.format}: ${s.hook||s.brief}`)}`,
   `DESCRIPTION:${escapeText(`Review state: ${s.state}\n${s.brief}\n${s.caption??''}\nPlanning snapshot only. Importing does not schedule or publish this post.`)}`,
   `STATUS:${s.state==='cancelled'?'CANCELLED':'TENTATIVE'}`,'TRANSP:TRANSPARENT','END:VEVENT');
 }
 lines.push('END:VCALENDAR');
 return {content:lines.map(fold).join('\r\n')+'\r\n',content_type:'text/calendar;charset=utf-8',extension:'ics'};
}
