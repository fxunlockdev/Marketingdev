"use client";
import {useCallback,useEffect,useState} from 'react';
import {api} from './api';
import {Notice,Loading} from './primitives';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {EmptyState} from './ui/empty-state';
import {StatusBadge} from './ui/status-badge';
import {AppLink} from './app-link';
import {formatLabel,metricName,metricValue,orderedMetrics} from './postforme-time';
import styles from './monthly-review.module.css';

type Pattern={direction:'top'|'bottom';dimension:string;value:string;metric:string;sample_size:number;above_median:number;below_median:number;label:string};
type Change={action:'do_more'|'do_less'|'respect_preference'|'collect_more';text:string;basis:string;sample_size:number;label:string};
type Accepted=Change&{id:string;month:string;accepted_at:string};
type ReviewPost={publication_id:string;caption:string;scheduled_at:string;provider:string;format:string;metrics:Record<string,number>|null;relative:'above'|'below'|'at_median'|'not_compared'};
type Review={month:string;timezone:string;published:ReviewPost[];performance:{compared:number;not_compared:number;label:string;top:Pattern[];bottom:Pattern[]};signals:{statement:string;count:number;of:number}[];proposed_changes:Change[];summary:string|null;can_accept:boolean;accepted:Accepted[]};

const thisMonth=()=>new Date().toISOString().slice(0,7);
function shift(month:string,by:number):string{const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+by,1));return d.toISOString().slice(0,7);}
const monthName=(month:string)=>new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T00:00:00Z'));
const describe=(p:Pattern)=>`${p.dimension.replaceAll('_',' ')}: ${p.value}`;
const RELATIVE:Record<ReviewPost['relative'],string>={above:'Above your median',below:'Below your median',at_median:'At your median',not_compared:'Not compared yet'};
const ACTION:Record<Change['action'],string>={do_more:'Do more',do_less:'Do less',respect_preference:'Customer preference',collect_more:'Collect more evidence'};

function PatternList({patterns,kind}:{patterns:Pattern[];kind:'worked'|'didnt'}){
 if(!patterns.length)return <p className={styles.meta}>{kind==='worked'?'Nothing stood out above your median yet.':'Nothing stood out below your median yet.'}</p>;
 return <ul className={styles.list}>{patterns.map(p=><li key={p.dimension+p.value} className={`${styles.item} ${styles[kind]}`}><p><strong>{describe(p)}</strong></p><p className={styles.meta}>{p.above_median} above and {p.below_median} below your own median {p.metric}, of {p.sample_size} compared posts · {p.label}</p></li>)}</ul>;
}
/** "What worked, what didn't" for one month, and the owner's choice of what to carry into next month's plan. */
export function MonthlyReview({businessId}:{businessId:string}){
 const root=`/api/v1/businesses/${businessId}/learning`;
 const [month,setMonth]=useState(()=>{if(typeof location==='undefined')return thisMonth();const m=new URLSearchParams(location.search).get('month');return m&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m)?m:thisMonth();});
 const [data,setData]=useState<Review>(),[error,setError]=useState<unknown>(),[chosen,setChosen]=useState<number[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=useCallback(async(m:string)=>{setData(undefined);setError(undefined);const v=await api<Review>(`${root}/review?month=${m}`);setData(v);setChosen(v.proposed_changes.map((c,i)=>c.action==='collect_more'||v.accepted.some(a=>a.text===c.text)?-1:i).filter(i=>i>=0));},[root]);
 useEffect(()=>{void load(month).catch(setError);},[month,load]);
 async function accept(){if(busy||!data||!chosen.length)return;setBusy(true);setError(undefined);setNotice('');try{const v=await api<Review>(`${root}/review/accept`,{month,changes:chosen,confirmed:true});setData(v);setChosen([]);setNotice('Saved. Next month’s plan will use these recommendations.');}catch(e){setError(e);}finally{setBusy(false);}}
 async function withdraw(id:string){if(busy)return;setBusy(true);setError(undefined);setNotice('');try{await api(`${root}/review/accepted/${id}/withdraw`,{});await load(month);setNotice('Removed. Next month’s plan will not use it.');}catch(e){setError(e);}finally{setBusy(false);}}
 return <section className={styles.review} aria-labelledby="review-title">
  <div className={styles.monthBar}><Button size="sm" variant="quiet" onClick={()=>setMonth(m=>shift(m,-1))} label="Previous month">←</Button><h2 id="review-title">{monthName(month)}</h2><Button size="sm" variant="quiet" disabled={month>=shift(thisMonth(),1)} onClick={()=>setMonth(m=>shift(m,1))} label="Next month">→</Button></div>
  <Notice error={error}/>{notice&&<p role="status" className="notice">{notice}</p>}
  {!data&&!error&&<Loading/>}
  {data&&<>
   {!data.published.length?<EmptyState title="Nothing published this month" description="The review compares posts published through Desvio. Choose another month, or come back after your posts go live."/>:<>
    <p className={styles.meta}>{data.published.length} published · {data.performance.compared} compared with your own median · {data.performance.not_compared} not compared yet (results take 72 hours to settle) · times in {data.timezone}. <StatusBadge status="needs_attention" label={data.performance.label}/></p>
    <div className={styles.columns}>
     <Card className="v5-panel"><h3>What worked</h3><PatternList patterns={data.performance.top} kind="worked"/></Card>
     <Card className="v5-panel"><h3>What didn’t</h3><PatternList patterns={data.performance.bottom} kind="didnt"/></Card>
    </div>
    <Card className="v5-panel"><h3>Published this month</h3><table className={styles.table}><thead><tr><th scope="col">Post</th><th scope="col">Format</th><th scope="col">Result</th><th scope="col">Lifetime totals</th></tr></thead><tbody>{data.published.map(p=><tr key={p.publication_id}><td className={styles.caption}>{p.caption.slice(0,140)}</td><td>{formatLabel(p.format)} · {p.provider}</td><td>{RELATIVE[p.relative]}</td><td>{p.metrics?orderedMetrics(p.metrics).slice(0,3).map(([k,v])=>`${metricValue(v)} ${metricName(k)}`).join(' · '):'No results yet'}</td></tr>)}</tbody></table></Card>
   </>}
   {data.signals.length>0&&<Card className="v5-panel"><h3>What you told us</h3><ul className={styles.list}>{data.signals.map(s=><li key={s.statement} className={styles.item}><p>{s.statement}</p></li>)}</ul></Card>}
   <Card elevation="low" className="v5-panel"><h3>For next month</h3>
    {data.accepted.length>0&&<ul className={styles.list} aria-label="In use for next month">{data.accepted.map(a=><li key={a.id} className={`${styles.item} ${styles.accepted}`}><div><p><strong>{ACTION[a.action]}:</strong> {a.text}</p><p className={styles.meta}>{a.basis} · {a.label}</p></div>{data.can_accept&&<Button size="sm" variant="quiet" disabled={busy} onClick={()=>void withdraw(a.id)} label="Stop using">Stop using</Button>}</li>)}</ul>}
    <fieldset className={styles.list} disabled={!data.can_accept||busy}><legend className={styles.meta}>{data.can_accept?'Choose what the next plan should use. Each recommendation shows its evidence and sample size.':'A business owner or administrator can choose what the next plan uses.'}</legend>
     {data.proposed_changes.map((c,i)=>{const used=data.accepted.some(a=>a.text===c.text);return <label key={c.text} className={styles.choice}><input type="checkbox" checked={used||chosen.includes(i)} disabled={used} onChange={e=>setChosen(v=>e.target.checked?[...v,i]:v.filter(x=>x!==i))}/><span><strong>{ACTION[c.action]}:</strong> {c.text}<br/><span className={styles.meta}>{c.basis} · sample {c.sample_size} · {c.label}{used?' · in use':''}</span></span></label>;})}
    </fieldset>
    <div className={styles.actions}>{data.can_accept&&<Button variant="primary" loading={busy} disabled={!chosen.length} onClick={()=>void accept()} label="Use this for next month">Use this for next month</Button>}<AppLink href={`/b/${businessId}/monthly-planning`}>Plan next month →</AppLink></div>
   </Card>
  </>}
 </section>;
}
