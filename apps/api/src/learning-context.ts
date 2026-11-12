import {CreativeError} from './creative-contracts.js';
import {canonicalJSON} from './brand-brain.js';
import {readPostformeObservations,type Queryable} from './learning-observations.js';
import {performancePatterns,UNPROVEN_SMALL,UNPROVEN_OBSERVED,PATTERN_DIMENSIONS,type Pattern} from './learning-patterns.js';
import {signalSummary,type PreferenceStatement} from './learning-signals.js';
export type LearningHypothesis={id:string;revision:number;kind:'unproven_hypothesis';hypothesis:string;next_test:string;applicability:string};
/** What this customer tends to approve, reject or change, counted from their own decisions. */
export type LearningPreference={kind:'customer_preference';statement:string;count:number;of:number;last_seen:string};
/** An attributed choice that sat above or below this business's own median. Always labelled unproven. */
export type LearningPattern={kind:'performance_pattern'}&Pattern;
/** A change the owner accepted from a monthly review ("Use this for next month"). Its text was proposed by the review, never typed. */
export type LearningAccepted={kind:'accepted_change';id:string;month:string;action:'do_more'|'do_less'|'respect_preference'|'collect_more';text:string;basis:string;sample_size:number;label:string};
/** v1 contexts are arrays of hypotheses only; v2 appends preference and pattern entries; v3 adds accepted review changes. Saved requests stay valid. */
export type LearningContext=(LearningHypothesis|LearningPreference|LearningPattern|LearningAccepted)[];
export const LEARNING_LIMITS={hypotheses:10,preferences:6,patterns:6,accepted:5,addedBytes:8000} as const;
export const ACCEPTED_ACTIONS=['do_more','do_less','respect_preference','collect_more'] as const;

function snapshot(row:any):LearningHypothesis{return {id:row.id,revision:row.revision,kind:'unproven_hypothesis',hypothesis:row.content.hypothesis,next_test:row.content.next_test,applicability:row.applicability};}
const keys=(r:object):string=>Object.keys(r).sort().join(',');
const count=(v:unknown):v is number=>Number.isInteger(v)&&(v as number)>=0&&(v as number)<=100000;
const short=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
function validHypothesis(r:any):boolean{return keys(r)==='applicability,hypothesis,id,kind,next_test,revision'&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/i.test(r.id)&&Number.isInteger(r.revision)&&r.revision>0&&typeof r.hypothesis==='string'&&r.hypothesis.length<=1000&&typeof r.next_test==='string'&&r.next_test.length<=1500&&typeof r.applicability==='string'&&r.applicability.length<=1000;}
function validPreference(r:any):boolean{return keys(r)==='count,kind,last_seen,of,statement'&&short(r.statement,300)&&count(r.count)&&count(r.of)&&r.count<=r.of&&r.of>0&&typeof r.last_seen==='string'&&Number.isFinite(Date.parse(r.last_seen))&&r.last_seen.length<=40;}
function validPattern(r:any):boolean{return keys(r)==='above_median,below_median,dimension,direction,kind,label,metric,sample_size,value'&&['top','bottom'].includes(r.direction)&&PATTERN_DIMENSIONS.includes(r.dimension)&&short(r.value,200)&&short(r.metric,200)&&count(r.sample_size)&&r.sample_size>=2&&count(r.above_median)&&count(r.below_median)&&r.above_median+r.below_median<=r.sample_size&&[UNPROVEN_SMALL,UNPROVEN_OBSERVED].includes(r.label);}
function validAccepted(r:any):boolean{return keys(r)==='action,basis,id,kind,label,month,sample_size,text'&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/i.test(r.id)&&typeof r.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)&&ACCEPTED_ACTIONS.includes(r.action)&&short(r.text,400)&&typeof r.basis==='string'&&r.basis.length<=400&&count(r.sample_size)&&short(r.label,60);}
export function learningSections(value:LearningContext):{hypotheses:LearningHypothesis[];preferences:LearningPreference[];patterns:LearningPattern[];accepted:LearningAccepted[]}{
 return {hypotheses:value.filter((r):r is LearningHypothesis=>r.kind==='unproven_hypothesis'),preferences:value.filter((r):r is LearningPreference=>r.kind==='customer_preference'),patterns:value.filter((r):r is LearningPattern=>r.kind==='performance_pattern'),accepted:value.filter((r):r is LearningAccepted=>r.kind==='accepted_change')};
}
export function validLearning(value:any):value is LearningContext{
 if(!Array.isArray(value)||value.some(r=>!r||typeof r!=='object'||Array.isArray(r)))return false;
 const {hypotheses,preferences,patterns,accepted}=learningSections(value);
 if(hypotheses.length+preferences.length+patterns.length+accepted.length!==value.length||hypotheses.length>LEARNING_LIMITS.hypotheses||preferences.length>LEARNING_LIMITS.preferences||patterns.length>LEARNING_LIMITS.patterns||accepted.length>LEARNING_LIMITS.accepted)return false;
 return hypotheses.every(validHypothesis)&&preferences.every(validPreference)&&patterns.every(validPattern)&&accepted.every(validAccepted)&&new Set(hypotheses.map(r=>r.id)).size===hypotheses.length&&new Set(accepted.map(r=>r.id)).size===accepted.length&&Buffer.byteLength(JSON.stringify([...accepted,...preferences,...patterns]))<=LEARNING_LIMITS.addedBytes;
}
export async function approvedLearning(db:any):Promise<LearningHypothesis[]>{return (await db.query("SELECT id,revision,content,applicability FROM app.memory_lessons WHERE state='testing' ORDER BY reviewed_at DESC,id LIMIT 10")).rows.map(snapshot);}

export function preferenceEntries(statements:readonly PreferenceStatement[]):LearningPreference[]{
 return statements.slice(0,LEARNING_LIMITS.preferences).map(s=>({kind:'customer_preference',statement:s.statement.slice(0,300),count:s.count,of:s.of,last_seen:s.last_seen}));
}
export function patternEntries(patterns:{top:readonly Pattern[];bottom:readonly Pattern[]}):LearningPattern[]{
 const half=LEARNING_LIMITS.patterns/2;return [...patterns.top.slice(0,half),...patterns.bottom.slice(0,half)].map(p=>({kind:'performance_pattern',...p}));
}
/** Drop optional entries from the end until the added sections fit their byte budget. Hypotheses are never dropped. */
function bounded(hypotheses:LearningHypothesis[],added:(LearningAccepted|LearningPreference|LearningPattern)[]):LearningContext{
 let kept=added;while(kept.length&&Buffer.byteLength(JSON.stringify(kept))>LEARNING_LIMITS.addedBytes)kept=kept.slice(0,-1);return [...hypotheses,...kept];
}
/**
 * Learning context v2 for planners: (a) human-approved hypotheses, (b) the customer's preference summary from their own
 * decisions, (c) top and bottom attributed patterns with sample sizes and an explicit unproven label.
 * Reads customer-scoped tables, so call it in the API's business transaction, not from a worker job.
 */
export async function planningLearning(db:Queryable,now:Date=new Date()):Promise<LearningContext>{
 const hypotheses=await approvedLearning(db),accepted=await acceptedChanges(db,now),preferences=preferenceEntries(await signalSummary(db,now)),patterns=patternEntries(performancePatterns((await readPostformeObservations(db)).observations));
 return bounded(hypotheses,[...accepted,...preferences,...patterns]);
}
/** Accepted changes from the last three review months, newest first; withdrawn ones are left out. Customer-scoped (API transaction). */
export const acceptedChangesSQL="SELECT id,month,action,text,basis,sample_size,label FROM app.learning_accepted_changes WHERE withdrawn_at IS NULL AND month>=$1 ORDER BY month DESC,accepted_at DESC,id LIMIT 5";
export async function acceptedChanges(db:Queryable,now:Date=new Date()):Promise<LearningAccepted[]>{
 const since=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-3,1)).toISOString().slice(0,7);
 return ((await db.query(acceptedChangesSQL,[since])).rows as Omit<LearningAccepted,'kind'>[]).map(r=>({kind:'accepted_change' as const,id:r.id,month:r.month,action:r.action,text:r.text,basis:r.basis,sample_size:Number(r.sample_size),label:r.label})).filter(validAccepted);
}
/** For a worker re-reading a saved request: hypotheses come fresh from the database, saved preference and pattern snapshots are kept. */
export async function refreshLearning(db:any,saved:unknown):Promise<LearningContext>{
 const context=saved??[];if(!validLearning(context))throw new CreativeError('MEMORY_CONTEXT_INVALID');
 const {preferences,patterns,accepted}=learningSections(context);return [...await approvedLearning(db),...accepted,...preferences,...patterns];
}
/** Approved hypotheses must still be current. Preferences and patterns are point-in-time snapshots and are only shape-checked. */
export async function assertLearningCurrent(db:any,value:any){
 const context=value??[];if(!validLearning(context))throw new CreativeError('MEMORY_CONTEXT_INVALID');
 const {hypotheses}=learningSections(context);if(!hypotheses.length)return;
 const rows=(await db.query("SELECT id,revision,content,applicability FROM app.memory_lessons WHERE id=ANY($1::uuid[]) AND state='testing'",[hypotheses.map(r=>r.id)])).rows;
 if(rows.length!==hypotheses.length||hypotheses.some(r=>{const row=rows.find((x:any)=>x.id===r.id);return !row||canonicalJSON(snapshot(row))!==canonicalJSON(r);}))throw new CreativeError('MEMORY_CONTEXT_CHANGED');
}
