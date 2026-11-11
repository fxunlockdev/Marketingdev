import type {Observation} from './learning-observations.js';
/**
 * Which attributed choices sat above or below this business's own median. Deterministic and deliberately modest:
 * posts are compared only within one provider, on one metric, once their lifetime total has had time to settle.
 * Raw values are never compared across providers and nothing here is a causal claim.
 */
export const SETTLED_HOURS=72;
export const MIN_GROUP=3;
export const SMALL_SAMPLE=10;
export const UNPROVEN_SMALL='unproven, small sample';
export const UNPROVEN_OBSERVED='unproven, observational';
const METRIC_PRIORITY=['engagement','engagements','likes','reactions','impressions','views','reach','comments','shares','saves','clicks'];
export const PATTERN_DIMENSIONS=['format','channel','pillar','hook','cta','layout_archetype','stock_used','posted_weekday','posted_daypart'] as const;
export type PatternDimension=typeof PATTERN_DIMENSIONS[number];
export type Relative='above'|'below'|'at_median';
export type RelativeResult={publication_id:string;provider:string;metric:string;value:number;median:number;relative:Relative};
export type ComparedGroup={provider:string;metric:string;median:number;sample_size:number};
export type Comparison={results:RelativeResult[];groups:ComparedGroup[];excluded:{too_early:number;too_few_comparable:number}};
export type Pattern={direction:'top'|'bottom';dimension:PatternDimension;value:string;metric:string;sample_size:number;above_median:number;below_median:number;label:string};

export function median(values:readonly number[]):number{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;}
export const sampleLabel=(size:number):string=>size<SMALL_SAMPLE?UNPROVEN_SMALL:UNPROVEN_OBSERVED;
const rank=(metric:string):number=>{const i=METRIC_PRIORITY.indexOf(metric.toLowerCase());return i<0?METRIC_PRIORITY.length:i;};
/** The metric most of this provider's settled posts report; ties go to the engagement-first priority, then name. */
function providerMetric(posts:readonly Observation[]):string|null{
 const coverage=new Map<string,number>();for(const p of posts)for(const key of Object.keys(p.metrics))coverage.set(key,(coverage.get(key)??0)+1);
 return [...coverage].sort((a,b)=>b[1]-a[1]||rank(a[0])-rank(b[0])||a[0].localeCompare(b[0]))[0]?.[0]??null;
}
export function compareToOwnMedian(observations:readonly Observation[]):Comparison{
 const settled=observations.filter(o=>o.hours_since_publish!==null&&o.hours_since_publish>=SETTLED_HOURS),providers=[...new Set(settled.map(o=>o.provider))].sort();
 const results:RelativeResult[]=[],groups:ComparedGroup[]=[];let tooFew=0;
 for(const provider of providers){
  const posts=settled.filter(o=>o.provider===provider),metric=providerMetric(posts),measured=metric?posts.filter(o=>metric in o.metrics):[];
  if(!metric||measured.length<MIN_GROUP){tooFew+=posts.length;continue;}
  const mid=median(measured.map(o=>o.metrics[metric]));tooFew+=posts.length-measured.length;groups.push({provider,metric,median:mid,sample_size:measured.length});
  for(const o of measured){const value=o.metrics[metric];results.push({publication_id:o.publication_id,provider,metric,value,median:mid,relative:value>mid?'above':value<mid?'below':'at_median'});}
 }
 return {results,groups,excluded:{too_early:observations.length-settled.length,too_few_comparable:tooFew}};
}
export function daypart(hour:number|null):string|null{return hour===null?null:hour>=5&&hour<12?'morning':hour>=12&&hour<17?'afternoon':hour>=17&&hour<22?'evening':'night';}
function dimensionValue(o:Observation,dimension:PatternDimension):string|null{
 const value=dimension==='posted_daypart'?daypart(o.attribution.posted_hour):o.attribution[dimension];
 return value===null||value===undefined||value===''?null:String(value).slice(0,200);
}
/** Top and bottom attributed patterns. A value needs two compared posts and some contrast (not every compared post shares it). */
export function performancePatterns(observations:readonly Observation[],max=3):{top:Pattern[];bottom:Pattern[];comparison:Comparison}{
 const comparison=compareToOwnMedian(observations),byId=new Map(observations.map(o=>[o.publication_id,o])),tallies=new Map<string,{dimension:PatternDimension;value:string;rows:RelativeResult[]}>();
 for(const result of comparison.results){const o=byId.get(result.publication_id);if(!o)continue;
  for(const dimension of PATTERN_DIMENSIONS){const value=dimensionValue(o,dimension);if(value===null)continue;const key=`${dimension}\u0000${value}`,t=tallies.get(key)??{dimension,value,rows:[]};tallies.set(key,{...t,rows:[...t.rows,result]});}
 }
 const scored=[...tallies.values()].filter(t=>t.rows.length>=2&&t.rows.length<comparison.results.length).map(t=>{
  const above=t.rows.filter(r=>r.relative==='above').length,below=t.rows.filter(r=>r.relative==='below').length;
  return {score:(above-below)/t.rows.length,pattern:{dimension:t.dimension,value:t.value,metric:[...new Set(t.rows.map(r=>r.metric))].sort().join(', '),sample_size:t.rows.length,above_median:above,below_median:below,label:sampleLabel(t.rows.length)}};
 });
 const order=(a:typeof scored[number],b:typeof scored[number]):number=>b.pattern.sample_size-a.pattern.sample_size||a.pattern.dimension.localeCompare(b.pattern.dimension)||a.pattern.value.localeCompare(b.pattern.value);
 return {comparison,
  top:scored.filter(s=>s.score>0).sort((a,b)=>b.score-a.score||order(a,b)).slice(0,max).map(s=>({direction:'top' as const,...s.pattern})),
  bottom:scored.filter(s=>s.score<0).sort((a,b)=>a.score-b.score||order(a,b)).slice(0,max).map(s=>({direction:'bottom' as const,...s.pattern}))};
}
