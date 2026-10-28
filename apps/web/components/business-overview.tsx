"use client";
import styles from './business-overview.module.css';
import {PostThumbnail} from "./post-thumbnail";
import {AppLink} from "./app-link";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Loading,Notice} from './primitives';
type UpcomingPost={creative_spec?:{placement:string;aspect:string}|null;video_version_id?:string|null;carousel_version_id?:string|null;project_id?:string|null;id:string;channel:string;format:string;hook:string;brief:string;state:string;planned_at:string;timezone:string;starts_on:string;plan_title:string;design:any;generation_status:string|null};
type Snapshot={campaigns:{id:string;title:string;starts_on:string;ends_on:string;post_count:number;awaiting_review:number;approved_count:number}[];upcoming_posts:UpcomingPost[];counts:{awaiting_review:number;approved_posts:number;creative_projects:number;active_jobs:number;published_posts:number;scheduled_posts:number;uncertain_publications:number;publication_attention:number;failed_jobs_last_week:number};activity:{id:string;kind:string;status:string;updated_at:string}[];checked_at:string;analytics_available:boolean;performance:{published_count:number;available_count:number;posts:{publication_id:string;caption:string;provider:string;account_name:string;state:string;collected_at:string|null;metrics:{label:string;date:string;value:number}[]}[]};recommendations:{id:string;state:string;title:string;summary:string;hypothesis:string;next_test:string;limitations:string[];evidence_count:number;applicability:string}[];generation_activity:{kind:string;requested:number;completed:number;uncertain:number}[]};
const labels:Record<string,string>={'asset.validate':'File validation','document.extract':'Brand document extraction','website.extract':'Website research','brand.analyze':'Brand analysis','creative.generate':'Creative generation','creative.video':'Video creation','insight.generate':'Performance analysis','creative.export':'Final image preparation','plan.generate':'Content planning','social.sync':'Connection check','social.authorize':'Social authorization','social.connect':'Social account connection','social.provision':'Publishing account setup','social.publish':'Post submission','social.reconcile':'Publishing status check'};
export function BusinessOverviewPanel({business}:{business:{id:string;name:string;has_approved_brand:boolean}}){
 const [data,setData]=useState<Snapshot>(),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0);
 useEffect(()=>{setData(undefined);setError(undefined);let active=true,timer:ReturnType<typeof setTimeout>;let failures=0;const poll=async()=>{try{if(document.hidden)return;const value=await api<Snapshot>(`/api/v1/businesses/${business.id}/overview`);if(active){failures=0;setData(value);setError(undefined);}}catch(e){failures++;if(active)setError(e);}finally{if(active)timer=setTimeout(poll,Math.min(120000,30000*2**failures));}};void poll();return()=>{active=false;clearTimeout(timer);};},[business.id,retry]);
 const link=(section:string)=>`/b/${business.id}/${section}`;
 return <><h1 className="sr-only">Your content, at a glance.</h1><Notice error={error}/>{!data?(error?<button onClick={()=>setRetry(n=>n+1)}>Try again</button>:<Loading/>):<>
  {!business.has_approved_brand&&<section className="notice"><h2>Start with your brand</h2><p>Review the extracted details so every new creative starts with approved brand knowledge.</p><AppLink href={link('onboarding')}>Finish brand setup →</AppLink></section>}
  <section className="overview-upcoming" aria-labelledby="upcoming-heading">
    <div className="section-heading"><h2 id="upcoming-heading">Upcoming posts</h2><div className="actions"><AppLink className="button" href={link('content-plan')}>View calendar</AppLink></div></div>
    {data.upcoming_posts?.length?<ul className="upcoming-grid">{data.upcoming_posts.map(post=><li key={post.id}><AppLink className={`upcoming-post ${styles.card} ${!post.design&&!post.video_version_id&&!post.carousel_version_id?styles.pending:''}`} href={`${link('content-plan')}?start=${post.starts_on}&slot=${post.id}`}>
      <div className="upcoming-meta"><span>{post.creative_spec?.placement==='reel'?'Reel':post.creative_spec?.placement==='story'?(post.format==='video'?'Video story':'Image story'):post.format==='video'?'Video':post.format==='carousel'?'Carousel':'Image'} · {post.channel==='linkedin'?'LinkedIn':post.channel==='instagram'?'Instagram':post.channel}</span><time dateTime={post.planned_at}>{new Intl.DateTimeFormat(undefined,{timeZone:post.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(post.planned_at))}</time></div>
      <PostThumbnail businessId={business.id} post={post}/>
      <div className="upcoming-copy"><span className="status neutral">{postProgress(post)}</span><h3>{post.hook||post.brief}</h3><p>{post.plan_title}</p><span className="upcoming-open">Open post <span aria-hidden="true">→</span></span></div>
    </AppLink></li>)}</ul>:<div className="overview-content-empty"><h3>Your next posts start here</h3><p>Plan your first campaign to see your upcoming posts here.</p><AppLink className="button primary" href={link('campaign-new')}>Create a campaign</AppLink></div>}
  </section>
  {!!data.campaigns?.length&&<section className="overview-campaigns" aria-labelledby="campaigns-heading">
    <div className="section-heading"><h2 id="campaigns-heading">Your campaigns</h2><AppLink className="button" href={link('campaigns')}>See all campaigns</AppLink></div>
    <ul className="overview-campaign-list">{data.campaigns.map(campaign=><li key={campaign.id}><AppLink href={`${link('campaign-review')}?plan=${campaign.id}`}>
      <div><h3>{campaign.title}</h3><p><time dateTime={campaign.starts_on}>{campaignDate(campaign.starts_on)}</time> – <time dateTime={campaign.ends_on}>{campaignDate(campaign.ends_on)}</time></p></div>
      <span>{campaign.post_count} {campaign.post_count===1?'post':'posts'}{campaign.awaiting_review?` · ${campaign.awaiting_review} to review`:campaign.approved_count?` · ${campaign.approved_count} approved`:''}</span><span aria-hidden="true">→</span>
    </AppLink></li>)}</ul>
  </section>}
  <div className="overview-metrics">{[['Awaiting review',data.counts.awaiting_review,'review'],['Scheduled posts',data.counts.scheduled_posts,'publishing'],['Published posts',data.counts.published_posts,'publishing']].map(([label,value,section])=><AppLink className="v5-panel overview-metric" href={link(String(section))} key={label}><span>{label}</span><strong>{value}</strong><span className="hint">View →</span></AppLink>)}</div>

  {(data.counts.uncertain_publications+data.counts.publication_attention)>0&&<section className="notice"><h2>Some publications need a check</h2><p>{data.counts.uncertain_publications} uncertain submissions and {data.counts.publication_attention} publications with missing, failed or unavailable status checks. Desvio will not create duplicate submissions automatically.</p><AppLink href={link('publishing')}>Review publishing activity →</AppLink></section>}
  <details className="overview-details"><summary>Activity and results{data.counts.active_jobs>0?` · ${data.counts.active_jobs} in progress`:''}{data.counts.failed_jobs_last_week>0?` · ${data.counts.failed_jobs_last_week} need attention`:''}</summary><div className="overview-detail-content"><section className="v5-panel"><p className="eyebrow">Behind the scenes</p><h2>Recent activity</h2>{data.activity.length?<ul className="overview-activity">{data.activity.map(j=><li key={j.id}><div><strong>{labels[j.kind]??'Background task'}</strong><span>{new Date(j.updated_at).toLocaleString()}</span></div><span>{j.status==='succeeded'?(j.kind==='social.publish'?'Submission accepted':'Completed'):j.status==='retrying'?'Retrying':j.status==='queued'?'Queued':j.status==='running'?'Running':j.status==='canceled'?'Canceled':j.status==='rejected'?'Could not proceed':j.status==='unknown'?'Needs reconciliation':'Failed'}</span></li>)}</ul>:<p>No background activity has been recorded for this business yet.</p>}{data.counts.failed_jobs_last_week>0&&<p className="hint">{data.counts.failed_jobs_last_week} failed or rejected jobs in the past seven days. Review the relevant module for details.</p>}</section>
  <section className="v5-panel" aria-labelledby="overview-performance"><h2 id="overview-performance">Recent post results</h2>
   <p>{data.performance.available_count} of {data.performance.published_count} confirmed published posts have available metrics in their latest saved check.</p>
   <p className="hint">Latest reported values, with their measurement dates. Platforms may use different windows; these values are not summed or ranked.</p>
   {data.performance.posts.length?<ul className="overview-activity">{data.performance.posts.map(post=><li key={post.publication_id}><div><strong>{post.caption||'Published post'}</strong><span>{post.account_name} · {post.provider}</span>
    {post.metrics.length?<ul>{post.metrics.map(metric=><li key={metric.label}>{metric.label}: {metric.value.toLocaleString()} · {metric.date}</li>)}</ul>:<p>{post.state==='error'?'The latest metrics check failed.':post.state==='missing'?'The provider could not find this post.':post.state==='unavailable'?'The platform returned no metrics. This does not mean zero engagement.':'Metrics have not been collected yet.'}</p>}
    {post.collected_at&&<span>Checked {new Date(post.collected_at).toLocaleString()}</span>}</div></li>)}</ul>:<p>No confirmed published posts yet. Results will appear after publishing and a metrics check.</p>}
   <AppLink href={link('publishing')}>Open publishing and analytics →</AppLink>
  </section>
  <section className="v5-panel" aria-labelledby="overview-recommendations"><h2 id="overview-recommendations">Ideas from your performance</h2>
   {data.recommendations.length?<ul>{data.recommendations.map(idea=><li key={idea.id}><h3>{idea.title}</h3><p>{idea.state==='testing'?'Approved for testing · unproven':'AI proposal · needs review'}</p><p>{idea.summary}</p><p>{idea.hypothesis}</p><p><strong>Next test:</strong> {idea.next_test}</p>{idea.applicability&&<p>Applies to: {idea.applicability}</p>}<details><summary>Evidence and limitations ({idea.evidence_count} observations)</summary><ul>{idea.limitations.map((item,i)=><li key={i}>{item}</li>)}</ul><AppLink href={link('memory')}>Review source evidence in Learnings →</AppLink></details></li>)}</ul>:<p>No saved performance recommendations yet. Collect post metrics, then request an analysis in Learnings.</p>}
   <AppLink href={link('memory')}>Open Learnings →</AppLink>
  </section>
  <section className="v5-panel" aria-labelledby="overview-generation"><h2 id="overview-generation">Generation activity · last 30 days</h2>
   {data.generation_activity.length?<ul>{data.generation_activity.map(item=><li key={item.kind}>{labels[item.kind]}: {item.requested} requested · {item.completed} completed{item.uncertain>0?` · ${item.uncertain} need reconciliation`:''}</li>)}</ul>:<p>No generation requests in this period.</p>}<p className="hint">Counts represent saved requests, not credits or billing charges.</p>
  </section>
  </div></details>
 </>}</>;
}

function postProgress(post:UpcomingPost){
 if(post.generation_status==='unknown')return 'Needs a check';
 if(['queued','running','retrying'].includes(post.generation_status??''))return post.generation_status==='queued'?'Queued':post.format==='video'?'Creating video':post.format==='carousel'?'Creating carousel':'Creating image';
 if(['failed','rejected'].includes(post.generation_status??''))return 'Needs attention';
 return ({content_needed:'Ready to create',draft_ready:'Draft ready',pending_review:'Ready for review',approved:'Approved',changes_requested:'Changes requested',rejected:'Needs changes'} as Record<string,string>)[post.state]??'Open to review';
}

function campaignDate(day:string){return new Intl.DateTimeFormat(undefined,{timeZone:"UTC",month:"short",day:"numeric"}).format(new Date(day+"T12:00:00Z"));}
