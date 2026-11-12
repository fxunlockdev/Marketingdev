import {expectedTextFound} from './image-qa.js';
import {validTextMode,type TextMode} from './image-art-direction.js';

/** What a person reviewing a creative needs from its stored quality report: the verdict,
 * whether the designed text was checked and matched, what it actually reads, and a few short
 * notes. Bounded and re-validated; the raw checker output never leaves the server. */
export type QaSummary={
 verdict:'pass'|'flag'|'unavailable';
 text_mode:TextMode|null;
 expected_text:string[];
 text_matches:boolean|null;
 found_text:string[];
 notes:string[];
 retried:boolean;
 message:string;
};

const MAX_TEXTS=6,MAX_TEXT=120,MAX_NOTES=3,MAX_NOTE=160;
const CONTROL=/[\u0000-\u001f\u007f]/g;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clip=(value:unknown,max:number):string=>typeof value==='string'?value.replace(CONTROL,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const texts=(value:unknown,count:number,max:number):string[]=>Array.isArray(value)?value.map(v=>clip(v,max)).filter(Boolean).slice(0,count):[];

type Checked={text_matches:boolean;found_text:string[];artefacts:string[]};
function lastChecked(attempts:unknown):Checked|null{
 if(!Array.isArray(attempts))return null;
 for(const attempt of [...attempts].reverse()){
  const a=record(attempt),finding=record(a.finding);
  if(a.status==='checked'&&typeof finding.text_matches==='boolean')return {text_matches:finding.text_matches,found_text:texts(finding.found_text,MAX_TEXTS,MAX_TEXT),artefacts:texts(finding.artefacts,MAX_NOTES,MAX_NOTE)};
 }
 return null;
}
function nearStock(stock:unknown):boolean{
 const checks=record(stock).checks;const last=Array.isArray(checks)?record(checks[checks.length-1]):{};
 return last.status==='checked'&&last.too_close===true;
}
const quoted=(found:string[]):string=>found.length?found.map(t=>`'${t}'`).join(' / '):'no readable text';

function message(s:Omit<QaSummary,'message'>):string{
 if(s.verdict==='unavailable')return 'Not checked automatically. Read the text and look over the image before approving.';
 if(s.expected_text.length&&s.text_matches===false)return `Needs a look: ${s.text_mode==='in_image'?'headline':'text'} reads ${quoted(s.found_text)}`;
 if(s.verdict==='flag')return `Needs a look: ${s.notes[0]??'the automatic check found possible issues'}`;
 return s.expected_text.length?'Text checked: matches':'Checked: no issues found';
}

/** Null when the creative has no quality report (made before checks existed, or edited by hand). */
export function qaSummary(qa:unknown):QaSummary|null{
 const report=record(qa);
 if(!['pass','flag','unavailable'].includes(String(report.verdict)))return null;
 const verdict=report.verdict as QaSummary['verdict'],checked=verdict==='unavailable'?null:lastChecked(report.attempts);
 const expected=texts(report.expected_text,MAX_TEXTS,MAX_TEXT),copied=nearStock(report.stock_source);
 const textMatches=checked?checked.text_matches&&expectedTextFound(expected,checked.found_text):null;
 const notes=[...(copied?['Looks very close to the stock photo it was based on']:[]),...(checked?.artefacts??[])].slice(0,MAX_NOTES);
 const base={verdict:checked||verdict==='unavailable'?verdict:'unavailable' as const,text_mode:validTextMode(report.text_mode)?report.text_mode:null,expected_text:expected,text_matches:textMatches,found_text:checked?.found_text??[],notes,retried:report.retried===true};
 return {...base,message:message(base)};
}
