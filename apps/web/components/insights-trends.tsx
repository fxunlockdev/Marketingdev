"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice,Loading} from './primitives';
import {Card} from './ui/card';
import {EmptyState} from './ui/empty-state';
import {StatusBadge} from './ui/status-badge';
import {formatWhen} from './postforme-time';
import styles from './insights-trends.module.css';

type TrendGroup={dimension:'format'|'pillar'|'hook';value:string;measured:number;compared:number;above_median:number;below_median:number;label:string};
type Trends={window_days:number;published:number;measured:number;compared:number;medians:{provider:string;metric:string;median:number;sample_size:number}[];groups:TrendGroup[];months:{month:string;published:number;measured:number}[];as_of:string|null;label:string};
const DIMENSIONS:[TrendGroup['dimension'],string][]=[['format','Format'],['pillar','Content pillar'],['hook','Angle']];
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;

function GroupRow({group}:{group:TrendGroup}){
 const mid=group.compared-group.above_median-group.below_median,pct=(n:number)=>`${group.compared?Math.round(n/group.compared*100):0}%`;
 return <li className={styles.row}>
  <span className={styles.value}>{group.value}</span>
  {group.compared?<span className={styles.bar} role="img" aria-label={`${group.above_median} above, ${group.below_median} below and ${mid} at your median, of ${group.compared} compared`}><span className={styles.above} style={{width:pct(group.above_median)}}/><span className={styles.mid} style={{width:pct(mid)}}/><span className={styles.below} style={{width:pct(group.below_median)}}/></span>:<span className={styles.note}>Not compared yet</span>}
  <p className={styles.counts}>{group.measured} with results · {group.compared} compared · {group.above_median} above, {group.below_median} below your median · {group.label}</p>
 </li>;
}
/** Which formats, pillars and angles sat above or below this business's own median. Observational, labelled unproven. */
export function InsightsTrends({businessId}:{businessId:string}){
 const [data,setData]=useState<Trends>(),[error,setError]=useState<unknown>();
 useEffect(()=>{let alive=true;api<Trends>(`/api/v1/businesses/${businessId}/learning/trends`).then(v=>{if(alive)setData(v);}).catch(e=>{if(alive)setError(e);});return()=>{alive=false;};},[businessId]);
 if(error)return <Notice error={error}/>;
 if(!data)return <Loading/>;
 if(!data.published)return <EmptyState title="No published posts yet" description="Trends appear once posts are published through Desvio and their results are reported."/>;
 return <section className={styles.trends} aria-labelledby="trends-title">
  <Card elevation="low" className="v5-panel">
   <h2 id="trends-title">What’s working</h2>
   <dl className={styles.summary}><div><dt>Published · last {data.window_days} days</dt><dd>{data.published}</dd></div><div><dt>With results</dt><dd>{data.measured}</dd></div><div><dt>Settled and compared</dt><dd>{data.compared}</dd></div></dl>
   <p className={styles.note}>Each post is compared with this business’s own median on the metric its platform reports most ({data.medians.map(m=>`${m.metric} on ${m.provider}, median ${m.median} of ${m.sample_size}`).join('; ')||'not enough settled posts yet'}). Posts are compared after 72 hours. {data.as_of&&`Latest reading ${formatWhen(data.as_of,zone)}.`}</p>
   <StatusBadge status="needs_attention" label={data.label}/>
  </Card>
  <p className={styles.legend}><span className={styles.legendAbove}>Above your median</span><span className={styles.legendBelow}>Below your median</span></p>
  {DIMENSIONS.map(([dimension,title])=>{const groups=data.groups.filter(g=>g.dimension===dimension);return <Card key={dimension} className={`v5-panel ${styles.dimension}`}><h3>{title}</h3>{groups.length?<ul className={styles.rows}>{groups.map(g=><GroupRow key={g.value} group={g}/>)}</ul>:<p className={styles.note}>No published post records a {title.toLowerCase()} yet.</p>}</Card>;})}
  <Card className="v5-panel"><h3>By month</h3><table className={styles.months}><thead><tr><th scope="col">Month</th><th scope="col">Published</th><th scope="col">With results</th></tr></thead><tbody>{data.months.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.published}</td><td>{m.measured}</td></tr>)}</tbody></table></Card>
 </section>;
}
