import {randomUUID} from 'node:crypto';
import type {Queryable} from './learning-observations.js';
/** Customer decisions as learning signals, summarised deterministically into per-business preference statements. No model call. */
export const SIGNAL_KINDS=['approved','rejected','changes_requested','edited','regenerated','retried','stock_swapped'] as const;
export type SignalKind=typeof SIGNAL_KINDS[number];
export const SIGNAL_DIFF_FIELDS=['headline','body','cta','caption','hook','brief','pillar','storyline'] as const;
export type DiffField=typeof SIGNAL_DIFF_FIELDS[number];
export type SignalDiff=Partial<Record<DiffField,{before:string;after:string}>>;
export type SignalContext={format?:string;channel?:string;pillar?:string;layout_archetype?:string;stock_used?:boolean};
/** Mood boards and monthly plans have no slot or creative version of their own; they name their subject. */
export const SIGNAL_SUBJECTS=['moodboard','plan'] as const;
export type SignalSubject=typeof SIGNAL_SUBJECTS[number];
export type SignalInput={kind:SignalKind;slot_id?:string|null;creative_version_id?:string|null;version_kind?:'creative'|'carousel'|'video'|null;subject_kind?:SignalSubject|null;subject_id?:string|null;reason?:string|null;diff?:unknown;context?:unknown};
export type SignalScope={organizationId:string;brandId:string;actorId:string};
export type Signal={kind:SignalKind;slot_id:string|null;creative_version_id:string|null;version_kind:'creative'|'carousel'|'video'|null;subject_kind:SignalSubject|null;subject_id:string|null;reason:string;diff:SignalDiff;context:SignalContext};
export type SignalRow={kind:string;reason:string;diff:unknown;context:unknown;created_at:string|Date};
export type PreferenceStatement={kind:'rejection_reason'|'decision'|'edit'|'regeneration'|'stock';statement:string;count:number;of:number;recent:number;last_seen:string};
export class SignalError extends Error{constructor(readonly code:'SIGNAL_INVALID'){super(code);}}

export const SIGNAL_REASON_MAX=1000;
const DIFF_TEXT_MAX=500,DIFF_BYTES_MAX=7000,CONTEXT_TEXT_MAX=140,WINDOW_DAYS=180,RECENT_DAYS=30,MAX_STATEMENTS=8,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(value:unknown,max:number):string=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const id=(value:unknown):string|null=>{if(value===null||value===undefined)return null;if(typeof value!=='string'||!UUID.test(value))throw new SignalError('SIGNAL_INVALID');return value.toLowerCase();};

function diffWithin(source:Record<string,unknown>,max:number):SignalDiff{
 const out:SignalDiff={};
 for(const field of SIGNAL_DIFF_FIELDS){const change=record(source[field]),before=clean(change.before,max),after=clean(change.after,max);if((before||after)&&before!==after)out[field]={before,after};}
 return out;
}
/** Keep only known text fields that actually changed, bounded per field and in total bytes. */
export function signalDiff(value:unknown):SignalDiff{
 const source=record(value);
 for(let max=DIFF_TEXT_MAX;;max=Math.floor(max/2)){const out=diffWithin(source,max);if(max<=16||Buffer.byteLength(JSON.stringify(out))<=DIFF_BYTES_MAX)return out;}
}
export function signalContext(value:unknown):SignalContext{
 const source=record(value),out:SignalContext={};
 for(const key of ['format','channel','pillar','layout_archetype'] as const){const text=clean(source[key],CONTEXT_TEXT_MAX);if(text)out[key]=text;}
 if(typeof source.stock_used==='boolean')out.stock_used=source.stock_used;
 return out;
}
export function normaliseSignal(input:unknown):Signal{
 const v=record(input);if(!SIGNAL_KINDS.includes(v.kind as SignalKind))throw new SignalError('SIGNAL_INVALID');
 const slot=id(v.slot_id),version=id(v.creative_version_id),kind=version?(v.version_kind??'creative'):null,subject=id(v.subject_id),subjectKind=v.subject_kind??null;
 if((!slot&&!version&&!subject)||(kind!==null&&!['creative','carousel','video'].includes(kind as string)))throw new SignalError('SIGNAL_INVALID');
 if((subject===null)!==(subjectKind===null)||(subjectKind!==null&&!SIGNAL_SUBJECTS.includes(subjectKind as SignalSubject)))throw new SignalError('SIGNAL_INVALID');
 return {kind:v.kind as SignalKind,slot_id:slot,creative_version_id:version,version_kind:kind as Signal['version_kind'],subject_kind:subjectKind as SignalSubject|null,subject_id:subject,reason:clean(v.reason,SIGNAL_REASON_MAX),diff:signalDiff(v.diff),context:signalContext(v.context)};
}
/** Append one signal inside the caller's business-scoped transaction. Call after the review/edit itself has succeeded. */
export async function recordSignal(db:Queryable,scope:SignalScope,input:SignalInput):Promise<{id:string}>{
 const s=normaliseSignal(input),signal=randomUUID();
 await db.query('INSERT INTO app.creative_signals(id,organization_id,brand_id,slot_id,creative_version_id,version_kind,kind,reason,diff,context,actor_id,subject_kind,subject_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[signal,scope.organizationId,scope.brandId,s.slot_id,s.creative_version_id,s.version_kind,s.kind,s.reason,JSON.stringify(s.diff),JSON.stringify(s.context),scope.actorId,s.subject_kind,s.subject_id]);
 return {id:signal};
}

const THEMES:readonly [string,RegExp][]=[
 ['people',/\b(people|persons?|faces?|models?|humans?|man|woman|men|women|portraits?)\b/i],
 ['a stock or generic look',/\b(stock|generic|clich[eé]d?|staged|fake)\b/i],
 ['the wording',/\b(text|wording|copy|headline|typos?|spelling|words)\b/i],
 ['colour',/\b(colou?rs?|palette|too bright|too dark|dull)\b/i],
 ['being off-brand',/\b(off[- ]brand|not (our|on)[- ]brand|brand|logo)\b/i],
 ['tone',/\b(tone|salesy|pushy|too formal|too casual|cheesy)\b/i],
 ['length',/\b(too long|wordy|shorter|shorten|too short)\b/i],
 ['a busy layout',/\b(busy|cluttered|crowded|messy)\b/i]
];
const FIELD_NAMES:Record<DiffField,string>={headline:'headlines',body:'body text',cta:'calls to action',caption:'captions',hook:'hooks',brief:'post briefs',pillar:'content pillars',storyline:'storylines'};
type Dated={at:number};
/** The database stamps signals with its own clock, which can run slightly ahead of this process. */
const CLOCK_SKEW_MS=5*60*1000;
type Tally={count:number;of:number;recent:number;last:number};
const tally=(hits:Dated[],of:number,now:number):Tally=>({count:hits.length,of,recent:hits.filter(h=>now-h.at<=RECENT_DAYS*86400000).length,last:Math.max(...hits.map(h=>h.at))});
const statement=(kind:PreferenceStatement['kind'],text:string,t:Tally,unit:string):PreferenceStatement=>({kind,statement:`${text}: ${t.count} of ${t.of} ${unit}`,count:t.count,of:t.of,recent:t.recent,last_seen:new Date(t.last).toISOString()});
const contextLabel=(key:string,value:string|boolean):string=>key==='stock_used'?(value?'posts using stock photos':'posts without stock photos'):key==='layout_archetype'?`${value} layouts`:key==='pillar'?`"${value}" posts`:`${value} posts`;

type Parsed=Dated&{kind:SignalKind;reason:string;diff:SignalDiff;context:SignalContext};
function parse(rows:readonly SignalRow[],now:number):Parsed[]{
 return rows.flatMap((row):Parsed[]=>{
  const at=row.created_at instanceof Date?row.created_at.getTime():Date.parse(String(row.created_at));
  if(!Number.isFinite(at)||at>now+CLOCK_SKEW_MS||now-at>WINDOW_DAYS*86400000||!SIGNAL_KINDS.includes(row.kind as SignalKind))return [];
  return [{at,kind:row.kind as SignalKind,reason:clean(row.reason,SIGNAL_REASON_MAX),diff:signalDiff(row.diff),context:signalContext(row.context)}];
 });
}
function reasonStatements(signals:Parsed[],now:number):PreferenceStatement[]{
 const reasoned=signals.filter(s=>s.kind==='rejected'&&s.reason);if(reasoned.length<2)return [];
 return THEMES.flatMap(([name,pattern])=>{const hits=reasoned.filter(s=>pattern.test(s.reason));return hits.length>=2?[statement('rejection_reason',`Rejection reasons mention ${name}`,tally(hits,reasoned.length,now),'rejections with a reason')]:[];});
}
function decisionStatements(signals:Parsed[],now:number):PreferenceStatement[]{
 const decisions=signals.filter(s=>s.kind==='approved'||s.kind==='rejected'),groups=new Map<string,{label:string;rows:Parsed[]}>();
 for(const s of decisions)for(const [key,value] of Object.entries(s.context)){const k=`${key}=${String(value)}`,g=groups.get(k)??{label:contextLabel(key,value),rows:[]};groups.set(k,{...g,rows:[...g.rows,s]});}
 return [...groups.values()].flatMap(g=>{
  if(g.rows.length<3)return [];const rejected=g.rows.filter(s=>s.kind==='rejected'),approved=g.rows.filter(s=>s.kind==='approved');
  if(rejected.length/g.rows.length>=0.6)return [statement('decision',`Rejects ${g.label}`,tally(rejected,g.rows.length,now),'decisions')];
  if(approved.length/g.rows.length>=0.8)return [statement('decision',`Approves ${g.label}`,tally(approved,g.rows.length,now),'decisions')];
  return [];
 });
}
function editStatements(signals:Parsed[],now:number):PreferenceStatement[]{
 const edits=signals.filter(s=>s.kind==='edited');
 return SIGNAL_DIFF_FIELDS.flatMap(field=>{
  const changed=edits.filter(s=>s.diff[field]);if(changed.length<2)return [];
  const shorter=changed.filter(s=>s.diff[field]!.after.length<s.diff[field]!.before.length),longer=changed.filter(s=>s.diff[field]!.after.length>s.diff[field]!.before.length);
  const [verb,hits]=shorter.length>=longer.length?['Shortens',shorter] as const:['Lengthens',longer] as const;
  return hits.length>=2&&hits.length/changed.length>=0.6?[statement('edit',`${verb} ${FIELD_NAMES[field]} when editing`,tally(hits,changed.length,now),`${field} edits`)]:[];
 });
}
function reworkStatements(signals:Parsed[],now:number):PreferenceStatement[]{
 const approved=signals.filter(s=>s.kind==='approved'),regenerated=signals.filter(s=>s.kind==='regenerated'),swapped=signals.filter(s=>s.kind==='stock_swapped'),stockApproved=approved.filter(s=>s.context.stock_used===true);
 return [
  ...(regenerated.length>=2?[statement('regeneration','Asks for a new version instead of approving',tally(regenerated,regenerated.length+approved.length,now),'regenerations and approvals')]:[]),
  ...(swapped.length>=2?[statement('stock','Swaps the suggested stock photo',tally(swapped,swapped.length+stockApproved.length,now),'stock photo decisions')]:[])
 ];
}
/** Preference statements with counts and recency, strongest first. Same rows and clock always give the same output. */
export function summariseSignals(rows:readonly SignalRow[],now:Date):PreferenceStatement[]{
 const clock=now.getTime(),signals=parse(rows,clock);
 return [...reasonStatements(signals,clock),...decisionStatements(signals,clock),...editStatements(signals,clock),...reworkStatements(signals,clock)]
  .sort((a,b)=>b.count-a.count||b.count/b.of-a.count/a.of||a.statement.localeCompare(b.statement)).slice(0,MAX_STATEMENTS);
}
export const recentSignalsSQL=`SELECT kind,reason,diff,context,created_at FROM app.creative_signals WHERE created_at>$1::timestamptz-interval '${WINDOW_DAYS} days' AND created_at<=$1::timestamptz+interval '5 minutes' ORDER BY created_at DESC,id LIMIT 500`;
export async function signalSummary(db:Queryable,now:Date=new Date()):Promise<PreferenceStatement[]>{
 return summariseSignals((await db.query(recentSignalsSQL,[now.toISOString()])).rows as SignalRow[],now);
}
