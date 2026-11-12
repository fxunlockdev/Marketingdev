import {attributionColumnsSQL,attributionJoinsSQL,type Attribution} from './learning-attribution.js';
import {postformeFeedsSQL,postformeSnapshotsSQL,postformeObservations,publishedFormat,type FeedRow,type Observation,type PublishedRow,type Queryable,type SnapshotRow} from './learning-observations.js';
import {performancePatterns,sampleLabel,type ComparedGroup,type Pattern,type Relative} from './learning-patterns.js';
import {summariseSignals,recentSignalsSQL,type PreferenceStatement,type SignalRow} from './learning-signals.js';
/** Monthly "what worked, what didn't" as data for a review screen. Everything except the optional summary is deterministic. */
export type ReviewScope={timezone?:string};
export type ReviewPost={publication_id:string;caption:string;scheduled_at:string;provider:string;format:string;attribution:Attribution|null;metrics:Record<string,number>|null;relative:Relative|'not_compared'};
export type ProposedChange={action:'do_more'|'do_less'|'respect_preference'|'collect_more';text:string;basis:string;sample_size:number;label:string};
export type MonthlyReview={month:string;timezone:string;published:ReviewPost[];performance:{groups:ComparedGroup[];above:string[];below:string[];compared:number;not_compared:number;label:string;top:Pattern[];bottom:Pattern[]};signals:PreferenceStatement[];proposed_changes:ProposedChange[];summary:string|null};
export class ReviewError extends Error{constructor(readonly code:'REVIEW_MONTH_INVALID'){super(code);}}
export const monthPublishedSQL=`SELECT p.id AS publication_id,p.caption,p.scheduled_at,p.release_url,p.account_id,a.platform AS provider,a.username AS account_name,s.format AS slot_format,s.carousel_version_id,s.video_version_id,p.proof->>'placement' AS placement,${attributionColumnsSQL} FROM app.postforme_publications p JOIN app.postforme_accounts a ON a.id=p.account_id JOIN app.content_slots s ON s.id=p.slot_id ${attributionJoinsSQL} WHERE p.phase='accepted' AND p.observed_state='published' AND p.scheduled_at>=$1 AND p.scheduled_at<$2 ORDER BY p.scheduled_at,p.id LIMIT 300`;

const zone=(value:unknown):string|null=>{if(typeof value!=='string'||!value)return null;try{new Intl.DateTimeFormat('en-US',{timeZone:value});return value;}catch{return null;}};
export function localMonth(at:string|Date,timezone:string):string{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit'}).formatToParts(new Date(at));
 return `${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}`;
}
function monthRange(month:string):{from:Date;to:Date;end:Date}{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new ReviewError('REVIEW_MONTH_INVALID');
 const [y,m]=month.split('-').map(Number),start=Date.UTC(y,m-1,1),end=Date.UTC(y,m,1);return {from:new Date(start-86400000),to:new Date(end+86400000),end:new Date(end)};
}
const describe=(p:Pattern):string=>`${p.dimension.replace(/_/g,' ')} "${p.value}"`;
const basis=(p:Pattern):string=>`${p.above_median} above and ${p.below_median} below this business's own median ${p.metric}, of ${p.sample_size} compared posts`;
/** Three to five proposals: strongest patterns and preferences first, then honest data-collection steps as filler. */
export function proposeChanges(patterns:{top:readonly Pattern[];bottom:readonly Pattern[]},signals:readonly PreferenceStatement[],counts:{published:number;compared:number;unmeasured:number}):ProposedChange[]{
 const strong:ProposedChange[]=[
  ...patterns.top.slice(0,2).map((p):ProposedChange=>({action:'do_more',text:`Plan more posts with ${describe(p)} and test it against the current mix.`,basis:basis(p),sample_size:p.sample_size,label:p.label})),
  ...patterns.bottom.slice(0,1).map((p):ProposedChange=>({action:'do_less',text:`Plan fewer posts with ${describe(p)}, or change one element and compare.`,basis:basis(p),sample_size:p.sample_size,label:p.label})),
  ...signals.slice(0,2).map((s):ProposedChange=>({action:'respect_preference',text:`Brief next month around this customer preference: ${s.statement}.`,basis:'customer review decisions',sample_size:s.of,label:'customer preference'}))];
 const filler:ProposedChange[]=[
  {action:'collect_more',text:counts.unmeasured?`Collect metrics for the ${counts.unmeasured} published post(s) that have no reading yet before drawing conclusions.`:'Keep collecting metrics at each checkpoint so next month has settled readings.',basis:`${counts.published} published, ${counts.compared} compared`,sample_size:counts.published,label:sampleLabel(counts.compared)},
  {action:'collect_more',text:'Vary one attribute at a time (format, pillar or posting time) so results can be attributed.',basis:'too little contrast to compare',sample_size:counts.compared,label:sampleLabel(counts.compared)},
  {action:'collect_more',text:'Ask for a reason on every rejection so preferences can be learned.',basis:`${signals.length} preference statement(s) so far`,sample_size:signals.length,label:'customer preference'}];
 return [...strong,...filler.slice(0,Math.max(0,3-strong.length))].slice(0,5);
}
export function buildReview(month:string,timezone:string,rows:PublishedRow[],observations:Observation[],signals:PreferenceStatement[]):Omit<MonthlyReview,'summary'>{
 const patterns=performancePatterns(observations),byId=new Map(observations.map(o=>[o.publication_id,o])),relative=new Map(patterns.comparison.results.map(r=>[r.publication_id,r.relative]));
 const published=rows.map((row):ReviewPost=>{const o=byId.get(row.publication_id);return {publication_id:row.publication_id,caption:row.caption.slice(0,300),scheduled_at:new Date(row.scheduled_at).toISOString(),provider:row.provider,format:o?.format??publishedFormat(row),attribution:o?.attribution??null,metrics:o?.metrics??null,relative:relative.get(row.publication_id)??'not_compared'};});
 const ids=(kind:Relative):string[]=>patterns.comparison.results.filter(r=>r.relative===kind).map(r=>r.publication_id),compared=patterns.comparison.results.length;
 return {month,timezone,published,performance:{groups:patterns.comparison.groups,above:ids('above'),below:ids('below'),compared,not_compared:rows.length-compared,label:sampleLabel(compared),top:patterns.top,bottom:patterns.bottom},signals,
  proposed_changes:proposeChanges(patterns,signals,{published:rows.length,compared,unmeasured:rows.length-observations.length})};
}
/** `summarise` is an optional model-written paragraph; if it fails the deterministic review is still returned with summary null. */
export async function monthlyReview(db:Queryable,scope:ReviewScope,month:string,options:{now?:Date;summarise?:(review:Omit<MonthlyReview,'summary'>)=>Promise<string>}={}):Promise<MonthlyReview>{
 const range=monthRange(month),fallback=zone(scope.timezone)??'UTC',now=options.now??new Date(),asOf=now<range.end?now:range.end;
 const rows=((await db.query(monthPublishedSQL,[range.from.toISOString(),range.to.toISOString()])).rows as PublishedRow[]).filter(r=>localMonth(r.scheduled_at,zone(r.timezone)??fallback)===month);
 const feeds=rows.length?(await db.query(postformeFeedsSQL)).rows as FeedRow[]:[],snapshots=rows.length?(await db.query(postformeSnapshotsSQL,[rows.map(r=>r.publication_id)])).rows as SnapshotRow[]:[];
 const signals=summariseSignals((await db.query(recentSignalsSQL,[asOf.toISOString()])).rows as SignalRow[],asOf);
 const review=buildReview(month,fallback,rows,postformeObservations(rows,feeds,snapshots),signals);
 let summary:string|null=null;
 if(options.summarise){try{const text=await options.summarise(review);summary=typeof text==='string'&&text.trim()?text.trim().slice(0,2000):null;}catch{summary=null;}}
 return {...review,summary};
}
