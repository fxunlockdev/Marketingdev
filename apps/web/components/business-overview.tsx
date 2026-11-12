"use client";
import styles from './business-overview.module.css';
import {PostThumbnail} from "./post-thumbnail";
import {AppLink} from "./app-link";
import {useEffect,useState} from 'react';
import {api} from './api';
import {Loading,Notice} from './primitives';
import {Button} from './ui/button';
import {Card} from './ui/card';
import {EmptyState} from './ui/empty-state';
import {StatusBadge,type Status} from './ui/status-badge';
type UpcomingPost={creative_spec?:{placement:string;aspect:string}|null;video_version_id?:string|null;carousel_version_id?:string|null;project_id?:string|null;id:string;channel:string;format:string;hook:string;brief:string;state:string;planned_at:string;timezone:string;starts_on:string;plan_title:string;design:any;generation_status:string|null};
type Snapshot={campaigns:{id:string;title:string;starts_on:string;ends_on:string;post_count:number;awaiting_review:number;approved_count:number}[];upcoming_posts:UpcomingPost[];counts:{awaiting_review:number;approved_posts:number;creative_projects:number;active_jobs:number;published_posts:number;scheduled_posts:number;uncertain_publications:number;publication_attention:number;failed_jobs_last_week:number};activity:{id:string;kind:string;status:string;updated_at:string}[];checked_at:string;analytics_available:boolean;performance:{published_count:number;available_count:number;posts:{publication_id:string;caption:string;provider:string;account_name:string;state:string;collected_at:string|null;metrics:{label:string;date:string;value:number}[]}[]};recommendations:{id:string;state:string;title:string;summary:string;hypothesis:string;next_test:string;limitations:string[];evidence_count:number;applicability:string}[];generation_activity:{kind:string;requested:number;completed:number;uncertain:number}[]};
const labels:Record<string,string>={'asset.validate':'File validation','document.extract':'Brand document extraction','website.extract':'Website research','brand.analyze':'Brand analysis','creative.generate':'Creative generation','creative.video':'Video creation','insight.generate':'Performance analysis','creative.export':'Final image preparation','plan.generate':'Content planning','social.sync':'Connection check','social.authorize':'Social authorization','social.connect':'Social account connection','social.provision':'Publishing account setup','social.publish':'Post submission','social.reconcile':'Publishing status check'};
export function BusinessOverviewPanel({business,name}:{name?:string;business:{id:string;name:string;has_approved_brand:boolean}}){
 const [data,setData]=useState<Snapshot>(),[error,setError]=useState<unknown>(),[retry,setRetry]=useState(0);
 useEffect(()=>{setData(undefined);setError(undefined);let active=true,timer:ReturnType<typeof setTimeout>;let failures=0;const poll=async()=>{try{if(document.hidden)return;const value=await api<Snapshot>(`/api/v1/businesses/${business.id}/overview`);if(active){failures=0;setData(value);setError(undefined);}}catch(e){failures++;if(active)setError(e);}finally{if(active)timer=setTimeout(poll,Math.min(120000,30000*2**failures));}};void poll();return()=>{active=false;clearTimeout(timer);};},[business.id,retry]);
 const [activityOpen,setActivityOpen]=useState(false);
 const link=(section:string)=>`/b/${business.id}/${section}`;
 const postLink=(post:UpcomingPost)=>`${link('content-plan')}?start=${post.starts_on}&slot=${post.id}`;
 const upcoming=data?.upcoming_posts??[],counts=data?.counts;
 const awaiting=counts?.awaiting_review??0,publishingChecks=(counts?.uncertain_publications??0)+(counts?.publication_attention??0),failedJobs=counts?.failed_jobs_last_week??0;
 const failedPosts=upcoming.filter(post=>['failed','rejected'].includes(post.generation_status??'')),uncertainPosts=upcoming.filter(post=>post.generation_status==='unknown'),reviewPosts=upcoming.filter(post=>post.state==='pending_review');
 // Every row names the thing that needs the customer and opens it, so the count is the number of rows.
 const attention:AttentionItem[]=[
  ...(!business.has_approved_brand?[{key:'brand',title:'Finish your brand setup',detail:'Confirm your business details so new content matches your brand.',href:link('guided-onboarding')}]:[]),
  ...(awaiting===1&&reviewPosts.length===1?[{key:'review',title:`Review “${postTitle(reviewPosts[0])}”`,detail:`Planned for ${postDate(reviewPosts[0])}. Approve it or request changes.`,href:link('review')}]:awaiting>0?[{key:'review',title:`${awaiting} posts are waiting for your approval`,detail:reviewPosts.length?`Including “${postTitle(reviewPosts[0])}”, planned for ${postDate(reviewPosts[0])}.`:'Approve them or request changes before they are scheduled.',href:link('review')}]:[]),
  ...failedPosts.slice(0,3).map(post=>({key:post.id,title:`“${postTitle(post)}” could not be created`,detail:`${formatName(post)} planned for ${postDate(post)}. Open the post to try again.`,href:postLink(post)})),
  ...uncertainPosts.slice(0,2).map(post=>({key:post.id,title:`“${postTitle(post)}” needs a status check`,detail:`We could not confirm whether this ${formatName(post).toLowerCase()} finished. Open the post to check before retrying.`,href:postLink(post)})),
  ...(publishingChecks>0?[{key:'publishing',title:`${publishingChecks} ${publishingChecks===1?'publication needs':'publications need'} a status check`,detail:'A submission or its latest check did not complete. Nothing is resubmitted automatically.',href:link('publishing')}]:[]),
  ...(failedJobs>0&&!failedPosts.length?[{key:'jobs',title:`${failedJobs} background ${failedJobs===1?'task':'tasks'} failed this week`,detail:'See which ones under Activity and results.',href:'#overview-activity',onClick:()=>setActivityOpen(true)}]:[]),
 ];
 const primary=!business.has_approved_brand?{label:'Finish brand setup',href:link('guided-onboarding')}:awaiting>0?{label:awaiting===1?'Review 1 post':`Review ${awaiting} posts`,href:link('review')}:{label:'Plan my content',href:link('monthly-planning')};
 const planIsPrimary=primary.href===link('monthly-planning');
 const metrics:[string,number,string][]=[['Waiting for approval',awaiting,'review'],['Queued to publish',counts?.scheduled_posts??0,'publishing'],['Published',counts?.published_posts??0,'publishing']];
 return <><Notice error={error}/>{!data?(error?<Button onClick={()=>setRetry(n=>n+1)}>Try again</Button>:<Loading/>):<div className={styles.dashboard}>
  <header className={styles.heading}><div><p className="eyebrow">{new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric'}).format(new Date())}</p><h1>{name?`Hello, ${name.split(' ')[0]}`:'Your dashboard'}</h1><p>{upcoming.length?`${upcoming.length===1?'1 post is':`${upcoming.length} posts are`} coming up, the next on ${postDate(upcoming[0])}.`:'Nothing is planned yet. A month of content starts with one plan.'}</p></div>
   <div className={styles.headingActions}>{!planIsPrimary&&<Button href={link('monthly-planning')}>Plan my content</Button>}<Button variant="primary" size="lg" href={primary.href}>{primary.label}</Button></div></header>
  <div className={styles.topGrid}>
   <Card tone="inverse" role="region" aria-labelledby="attention-heading" className={styles.attention}><div className={styles.sectionHeader}><h2 id="attention-heading">Needs your attention</h2>{attention.length>0&&<span className={styles.count} aria-label={`${attention.length} ${attention.length===1?'item':'items'}`}>{attention.length}</span>}</div>
    {attention.length?<ul>{attention.map(item=><li key={item.key}><AppLink href={item.href} onClick={item.onClick}><div><h3>{item.title}</h3><p>{item.detail}</p></div><span className={styles.arrow} aria-hidden="true">→</span></AppLink></li>)}</ul>:<EmptyState compact title="You’re up to date" description="No approvals, failed creations or publishing checks are waiting for you."/>}
    {(counts?.active_jobs??0)>0&&<p className={styles.progress} role="status">{counts?.active_jobs} {counts?.active_jobs===1?'task is':'tasks are'} in progress. Your saved work will stay here.</p>}
   </Card>
   <Card role="region" aria-labelledby="upcoming-heading" className={styles.upcoming}><div className={styles.sectionHeader}><div><h2 id="upcoming-heading">Upcoming posts</h2>{upcoming.length>0&&<p className={styles.sectionNote}>{upcoming.length===1?'Your next post':`Your next ${upcoming.length} posts`}, in date order</p>}</div><AppLink className={styles.sectionLink} href={link('content-plan')}>View calendar</AppLink></div>
    {upcoming.length?<ul className={styles.postList}>{upcoming.map((post,index)=>{const status=postStatus(post);return <li key={post.id}><AppLink className={styles.postRow} href={postLink(post)}>
     <div className={styles.thumbnail}>{hasPreview(post)?<PostThumbnail businessId={business.id} post={post} priority={index<3} sizes="72px"/>:<FormatMark format={post.format}/>}</div>
     <div className={styles.postCopy}><h3>{postTitle(post)}</h3><p>{formatName(post)} · {channelName(post.channel)}</p><StatusBadge status={status.status} label={status.label}/></div>
     <time dateTime={post.planned_at}>{postDate(post)}</time>
    </AppLink></li>;})}</ul>:<EmptyState compact title="A little planning goes a long way" description="Plan a month and your posts will line up here in date order." action={planIsPrimary?undefined:<Button href={link('monthly-planning')}>Plan my content</Button>}/>}
   </Card>
  </div>
  {metrics.some(([,value])=>value>0)&&<div className={styles.metrics}>{metrics.map(([label,value,section])=><AppLink href={link(section)} key={label}><span>{label}</span><strong>{value}</strong><span aria-hidden="true">→</span></AppLink>)}</div>}
  <div className={styles.insightsGrid}>
   <Card role="region" aria-labelledby="performance-heading" className={styles.insightCard}><h2 id="performance-heading">Performance</h2><p>{data.performance.published_count?`${data.performance.available_count} of ${data.performance.published_count} published posts have saved results.`:'Your results will appear after your first posts are published and checked.'}</p><AppLink href={link('publishing')}>View results →</AppLink></Card>
   <Card tone="accent" role="region" aria-labelledby="ideas-heading" className={styles.insightCard}><h2 id="ideas-heading">Research & ideas</h2>{data.recommendations[0]?<><h3>{data.recommendations[0].title}</h3><p>{data.recommendations[0].summary}</p><p className="hint">A suggestion from saved results, ready for your review.</p></>:<p>Your saved brand knowledge and content learnings help shape what comes next.</p>}<AppLink href={link('memory')}>Explore your learnings →</AppLink></Card>
  </div>
  {!!data.campaigns?.length&&<section className="overview-campaigns" aria-labelledby="campaigns-heading">
    <div className="section-heading"><h2 id="campaigns-heading">Your content plans</h2></div>
    <ul className="overview-campaign-list">{data.campaigns.map(campaign=><li key={campaign.id}><AppLink href={`${link('content-plan')}?plan=${campaign.id}`}>
      <div><h3>{campaign.title}</h3><p><time dateTime={campaign.starts_on}>{campaignDate(campaign.starts_on)}</time> – <time dateTime={campaign.ends_on}>{campaignDate(campaign.ends_on)}</time></p></div>
      <span>{campaign.post_count} {campaign.post_count===1?'post':'posts'}{campaign.awaiting_review?` · ${campaign.awaiting_review} to review`:campaign.approved_count?` · ${campaign.approved_count} approved`:''}</span><span aria-hidden="true">→</span>
    </AppLink></li>)}</ul>
  </section>}


  {(data.counts.uncertain_publications+data.counts.publication_attention)>0&&<section className="notice"><h2>Some publications need a check</h2><p>{data.counts.uncertain_publications} uncertain submissions and {data.counts.publication_attention} publications with missing, failed or unavailable status checks. Desvio will not create duplicate submissions automatically.</p><AppLink href={link('publishing')}>Review publishing activity →</AppLink></section>}
  <details className="overview-details" id="overview-activity" open={activityOpen} onToggle={event=>setActivityOpen(event.currentTarget.open)}><summary>Activity and results{data.counts.active_jobs>0?` · ${data.counts.active_jobs} in progress`:''}{data.counts.failed_jobs_last_week>0?` · ${data.counts.failed_jobs_last_week} need attention`:''}</summary><div className="overview-detail-content"><section className="v5-panel"><p className="eyebrow">Behind the scenes</p><h2>Recent activity</h2>{data.activity.length?<ul className="overview-activity">{data.activity.map(j=><li key={j.id}><div><strong>{labels[j.kind]??'Background task'}</strong><span>{new Date(j.updated_at).toLocaleString()}</span></div><span>{j.status==='succeeded'?(j.kind==='social.publish'?'Submission accepted':'Completed'):j.status==='retrying'?'Retrying':j.status==='queued'?'Queued':j.status==='running'?'Running':j.status==='canceled'?'Canceled':j.status==='rejected'?'Could not proceed':j.status==='unknown'?'Needs reconciliation':'Failed'}</span></li>)}</ul>:<p>No background activity has been recorded for this business yet.</p>}{data.counts.failed_jobs_last_week>0&&<p className="hint">{data.counts.failed_jobs_last_week} failed or rejected jobs in the past seven days. Review the relevant module for details.</p>}</section>
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
 </div>}</>;
}

type AttentionItem={key:string;title:string;detail:string;href:string;onClick?:()=>void};
function postTitle(post:UpcomingPost):string{return post.hook||post.brief.split(/\n\s*(?:Additional creative direction|Image direction):/i)[0]||'Untitled post';}
function postDate(post:UpcomingPost):string{return new Intl.DateTimeFormat(undefined,{timeZone:post.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(post.planned_at));}
function formatName(post:UpcomingPost):string{return post.format==='carousel'?'Carousel':post.format==='video'?'Video':'Image';}
function channelName(channel:string):string{return channel==='linkedin'?'LinkedIn':channel==='instagram'?'Instagram':channel;}
function hasPreview(post:UpcomingPost):boolean{return Boolean(post.design?.background_media_id||post.video_version_id||post.carousel_version_id);}
/** A format glyph for posts with nothing to preview; the status badge beside it carries the words. */
function FormatMark({format}:{format:string}){
 const path=format==='video'?'M9 8.5v7l6-3.5Z M4 5h16v14H4Z':format==='carousel'?'M7 6h10v12H7Z M3 8.5v7 M21 8.5v7':'M4 5h16v14H4Z m0 10 4.5-4.5 4 4 2.5-2.5 5 5 M15.5 9.5h.01';
 return <svg className={styles.formatMark} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
}
function postStatus(post:UpcomingPost):{status:Status;label?:string}{
 const generation=post.generation_status??'';
 if(generation==='unknown')return {status:'needs_attention',label:'Needs a check'};
 if(['queued','running','retrying'].includes(generation))return {status:'in_progress',label:generation==='queued'?'Queued':post.format==='video'?'Creating video':post.format==='carousel'?'Creating carousel':'Creating image'};
 if(['failed','rejected'].includes(generation))return {status:'failed',label:'Could not be created'};
 const byState:Record<string,{status:Status;label?:string}>={content_needed:{status:'not_started'},draft_ready:{status:'draft_ready'},pending_review:{status:'in_review'},approved:{status:'approved'},changes_requested:{status:'needs_attention',label:'Changes requested'},rejected:{status:'needs_attention',label:'Needs changes'}};
 return byState[post.state]??{status:'not_started',label:'Open to review'};
}

function campaignDate(day:string){return new Intl.DateTimeFormat(undefined,{timeZone:"UTC",month:"short",day:"numeric"}).format(new Date(day+"T12:00:00Z"));}
