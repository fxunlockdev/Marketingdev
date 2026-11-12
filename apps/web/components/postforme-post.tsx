"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Notice} from './primitives';
import {AppLink} from './app-link';
import {StatusBadge,type Status} from './ui/status-badge';
import {formatWhen,metricName,metricValue,orderedMetrics} from './postforme-time';
import styles from './postforme-post.module.css';

type SlotPublication={id:string;phase:string;observed_state:string;scheduled_at:string;account_name:string;provider:string;release_url:string|null;failure_reason:string|null;error_code:string|null};
type PostMetrics={metrics:Record<string,number>;as_of:string;hours_since_publish:number|null};
type SlotPublishing={publications:SlotPublication[];metrics:PostMetrics|null;timezone:string};

/** Badge status and wording for one publication. Uncertain outcomes say so; nothing is resubmitted automatically. */
export function publicationStatus(p:{phase:string;observed_state:string;error_code?:string|null}):{status:Status;label:string}{
 if(p.phase==='canceled')return {status:'not_started',label:'Canceled'};
 if(p.phase==='rejected')return {status:'failed',label:'Not submitted'};
 if(p.phase==='unknown')return {status:'needs_attention',label:'Outcome uncertain'};
 if(p.phase!=='accepted')return {status:'in_progress',label:'Submitting'};
 if(p.observed_state==='published')return {status:'published',label:'Published'};
 if(p.observed_state==='failed')return {status:'failed',label:'Failed'};
 if(p.observed_state==='processing')return {status:'in_progress',label:'Publishing'};
 if(p.error_code)return {status:'needs_attention',label:'Status check needed'};
 return {status:'scheduled',label:'Scheduled'};
}

/** Publishing status and results of one calendar post, for its drawer. */
export function PostformePost({businessId,slotId}:{businessId:string;slotId:string}){
 const [data,setData]=useState<SlotPublishing>(),[error,setError]=useState<unknown>();
 useEffect(()=>{let alive=true;setData(undefined);setError(undefined);
  api<SlotPublishing>(`/api/v1/businesses/${businessId}/postforme/slots/${slotId}`).then(v=>{if(alive)setData(v);}).catch(e=>{if(alive)setError(e);});
  return()=>{alive=false;};},[businessId,slotId]);
 const latest=data?.publications[0],state=latest?publicationStatus(latest):null,link=`/b/${businessId}/publishing?slot=${slotId}`;
 return <section className={styles.panel} aria-labelledby={`publishing-${slotId}`}>
  <div className={styles.heading}><h3 id={`publishing-${slotId}`}>Publishing</h3>{state&&<StatusBadge status={state.status} label={state.label}/>}</div>
  <Notice error={error}/>
  {!data&&!error&&<p role="status" className={styles.meta}>Loading publishing status…</p>}
  {data&&!latest&&<><p className={styles.meta}>Not scheduled yet. Approved posts can be scheduled from Publishing.</p><div className={styles.actions}><AppLink href={link}>Schedule this post →</AppLink></div></>}
  {data&&latest&&<>
   <p className={styles.meta}>{latest.account_name} · {formatWhen(latest.scheduled_at,data.timezone)} ({data.timezone})</p>
   {latest.failure_reason&&<p className={styles.reason}>{latest.failure_reason}</p>}
   {latest.observed_state==='published'&&(data.metrics?<>
    <dl className={styles.metrics} aria-label="Lifetime results">{orderedMetrics(data.metrics.metrics).map(([k,v])=><div key={k}><dt>{metricName(k)}</dt><dd>{metricValue(v)}</dd></div>)}</dl>
    <p className={styles.meta}>Lifetime totals as of {formatWhen(data.metrics.as_of,data.timezone)}, as reported by the platform.</p>
   </>:<p className={styles.meta}>No results yet. They appear after the platform reports them; missing results are never shown as zero.</p>)}
   <div className={styles.actions}><AppLink href={link}>Open in Publishing →</AppLink>{latest.release_url&&<a href={latest.release_url} target="_blank" rel="noopener noreferrer">View published post ↗</a>}</div>
  </>}
 </section>;
}
