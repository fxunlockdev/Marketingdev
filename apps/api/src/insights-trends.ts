/** Simple, honest trends for the Insights page: which formats, pillars and angles sat above or below this business's own median. */
import {monthPublishedSQL} from './learning-review.js';
import {postformeFeedsSQL,postformeSnapshotsSQL,postformeObservations,type FeedRow,type Observation,type PublishedRow,type Queryable,type SnapshotRow} from './learning-observations.js';
import {compareToOwnMedian,sampleLabel,type ComparedGroup} from './learning-patterns.js';

export const TREND_DIMENSIONS=['format','pillar','hook'] as const;
export type TrendDimension=typeof TREND_DIMENSIONS[number];
/** `measured` posts have a reading; `compared` ones had settled long enough to be compared with the business's own median. */
export type TrendGroup={dimension:TrendDimension;value:string;measured:number;compared:number;above_median:number;below_median:number;label:string};
export type MonthTrend={month:string;published:number;measured:number};
export type Trends={window_days:number;from:string;to:string;published:number;measured:number;compared:number;medians:ComparedGroup[];groups:TrendGroup[];months:MonthTrend[];as_of:string|null;label:string};
export const TREND_WINDOW_DAYS=90;

function value(o:Observation,dimension:TrendDimension):string|null{const v=o.attribution[dimension];return typeof v==='string'&&v.trim()?v.trim().slice(0,200):null;}
/** Pure: group observations. A group is reported even with one post, always with its sample size and an unproven label. */
export function trendGroups(observations:readonly Observation[]):{groups:TrendGroup[];compared:number;medians:ComparedGroup[]}{
 const comparison=compareToOwnMedian(observations),relative=new Map(comparison.results.map(r=>[r.publication_id,r.relative]));
 const groups=new Map<string,TrendGroup>();
 for(const o of observations)for(const dimension of TREND_DIMENSIONS){
  const v=value(o,dimension);if(v===null)continue;
  const key=`${dimension}\u0000${v}`,g=groups.get(key)??{dimension,value:v,measured:0,compared:0,above_median:0,below_median:0,label:''},r=relative.get(o.publication_id);
  groups.set(key,{...g,measured:g.measured+1,compared:g.compared+(r?1:0),above_median:g.above_median+(r==='above'?1:0),below_median:g.below_median+(r==='below'?1:0)});
 }
 const order=TREND_DIMENSIONS as readonly string[];
 return {compared:comparison.results.length,medians:comparison.groups,groups:[...groups.values()].map(g=>({...g,label:sampleLabel(g.compared)})).sort((a,b)=>order.indexOf(a.dimension)-order.indexOf(b.dimension)||b.measured-a.measured||a.value.localeCompare(b.value))};
}
export function monthTrends(rows:readonly PublishedRow[],observations:readonly Observation[]):MonthTrend[]{
 const measured=new Set(observations.map(o=>o.publication_id)),months=new Map<string,MonthTrend>();
 for(const r of rows){const month=new Date(r.scheduled_at).toISOString().slice(0,7),m=months.get(month)??{month,published:0,measured:0};months.set(month,{...m,published:m.published+1,measured:m.measured+(measured.has(r.publication_id)?1:0)});}
 return [...months.values()].sort((a,b)=>a.month.localeCompare(b.month));
}
export async function performanceTrends(db:Queryable,now:Date=new Date(),days:number=TREND_WINDOW_DAYS):Promise<Trends>{
 const from=new Date(now.getTime()-days*86400000),to=new Date(now.getTime()+31*86400000);
 const rows=(await db.query(monthPublishedSQL,[from.toISOString(),to.toISOString()])).rows as PublishedRow[];
 const feeds=rows.length?(await db.query(postformeFeedsSQL)).rows as FeedRow[]:[],snapshots=rows.length?(await db.query(postformeSnapshotsSQL,[rows.map(r=>r.publication_id)])).rows as SnapshotRow[]:[];
 const observations=postformeObservations(rows,feeds,snapshots),{groups,compared,medians}=trendGroups(observations);
 const asOf=observations.map(o=>o.collected_at).sort().at(-1)??null;
 return {window_days:days,from:from.toISOString(),to:to.toISOString(),published:rows.length,measured:observations.length,compared,medians,groups,months:monthTrends(rows,observations),as_of:asOf,label:sampleLabel(compared)};
}
