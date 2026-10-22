import {randomUUID} from 'node:crypto';
import {ConflictException} from '@nestjs/common';
import {AssetJobs,type JobScope} from './jobs.js';
import {SocialJobs,SocialReadRetry,type SocialWorkerConfig} from './social-jobs.js';
import {PostizClient,PostizError} from './postiz-client.js';
import {PostizVault} from './postiz-vault.js';
import {CreativeExports} from './creative-exports.js';
import {publicationLocks} from './publication.js';
import {digest} from './object-store.js';
const terminal=new Set(['succeeded','failed','rejected','canceled']);
const transient=(e:PostizError)=>['POSTIZ_TIMEOUT','POSTIZ_NETWORK_ERROR','POSTIZ_UNAVAILABLE','POSTIZ_RATE_LIMITED'].includes(e.code);
export class PublicationJobs {
 #jobs:AssetJobs;#config?:SocialWorkerConfig;#vault?:PostizVault;#social:SocialJobs;#proof:CreativeExports;
 constructor(jobs:AssetJobs,config:SocialWorkerConfig|undefined,readonly image:string|undefined,readonly enabled=false){this.#jobs=jobs;this.#config=config;this.#social=new SocialJobs(jobs);this.#proof=new CreativeExports(null as any,image);if(config)this.#vault=new PostizVault(config.encryptionKey);}
 async record(db:any,j:any,phase:string,status:string,code:string|null=null){await db.query('UPDATE app.publication_requests SET phase=$2 WHERE job_id=$1',[j.id,phase]);return this.#social.finish(db,j,status,code);}
 async request(db:any,j:any){if(!['social.publish','social.reconcile'].includes(j.kind))throw new Error('JOB_KIND_DENIED');return (await db.query('SELECT * FROM app.publication_requests')).rows[0];}
 client(scope:JobScope,a:any){if(!this.#config||!this.#vault)throw new PostizError('POSTIZ_NOT_CONFIGURED');return new PostizClient(this.#config.client,{organizationId:scope.organizationId,brandId:scope.brandId,remoteOrganizationId:a.remote_organization_id,apiKey:this.#vault.open(a,a.encrypted_credential)});}
 async account(db:any,r:any){const a=(await db.query('SELECT * FROM app.postiz_accounts')).rows[0];if(!a?.enabled||!a.identity_verified_at||a.revision!==r.account_revision)throw new PostizError('POSTIZ_ACCOUNT_CHANGED');return a;}
 async validate(db:any,j:any,r:any){
  if(!this.enabled||!this.image)throw new PostizError('PUBLISHING_NOT_CONFIGURED');
  if(!await this.#social.permitted(db,j))throw new PostizError('PUBLICATION_ACCESS_REVOKED');
  if(!(await db.query('SELECT 1 FROM app.publication_grants WHERE channel_id=$1 AND expires_at>now()',[r.channel_id])).rowCount)throw new PostizError('PUBLICATION_GRANT_EXPIRED');
  const a=await this.account(db,r),c=(await db.query("SELECT remote_id FROM app.social_channels WHERE id=$1 AND provider='linkedin' AND observed_state='available' AND account_revision=$2",[r.channel_id,a.revision])).rows[0];if(c?.remote_id!==r.remote_channel_id)throw new PostizError('POSTIZ_CHANNEL_UNAVAILABLE');
  const e=await this.#proof.publicationProof(db,r.slot_id),s=(await db.query('SELECT s.revision,s.planned_at,s.channel,v.caption FROM app.content_slots s JOIN app.creative_versions v ON v.id=s.creative_version_id WHERE s.id=$1',[r.slot_id])).rows[0];
  if(!s||s.revision!==r.slot_revision||s.channel!=='linkedin'||e.id!==r.export_id||e.sha256!==r.image_sha256||s.caption!==r.caption||new Date(s.planned_at).getTime()!==new Date(r.scheduled_at).getTime())throw new PostizError('PUBLICATION_APPROVAL_CHANGED');
  if(new Date(r.scheduled_at).getTime()<=Date.now())throw new PostizError('PUBLICATION_TIME_PASSED');return {a,e};
 }
 async run(scope:JobScope):Promise<string>{
  try{
   const r=await this.#jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='social.publish')throw new Error('JOB_KIND_DENIED');const r=await this.request(db,j);if(!r)throw new Error('PUBLICATION_MISSING');if(terminal.has(j.status))return r.phase==='accepted'?r:null;
    if(['uploading','submitting','unknown'].includes(r.phase)){await this.record(db,j,'unknown','failed','PUBLICATION_OUTCOME_UNKNOWN');return null;}
    await publicationLocks(db,j.brand_id);await this.validate(db,j,r);await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);return r;
   });if(!r)return 'finished';if(r.phase==='accepted')return 'accepted';
   if(r.phase==='queued'){
    // Fetch/hash the immutable export before claiming a remote mutation.
    const e=await this.#jobs.transaction(scope,async(db,j)=>{await publicationLocks(db,j.brand_id);const current=await this.request(db,j);return (await this.validate(db,j,current)).e;});
    const bytes=await this.#jobs.store.read(e.object_key);if(bytes.length!==e.bytes||digest(bytes)!==r.image_sha256)throw new PostizError('PUBLICATION_IMAGE_INVALID');
    await this.claim(scope,'queued','uploading');
    await this.#jobs.transaction(scope,async(db,j)=>{await db.query("SET LOCAL idle_in_transaction_session_timeout='90s'");await publicationLocks(db,j.brand_id);const current=await this.request(db,j);if(current.phase!=='uploading')throw new PostizError('PUBLICATION_OUTCOME_UNKNOWN');const {a}=await this.validate(db,j,current);
     const media=await this.client(scope,a).uploadPNG(bytes,current.image_sha256);await db.query("UPDATE app.publication_requests SET remote_media=$2,phase='uploaded' WHERE job_id=$1",[j.id,JSON.stringify(media)]);
    });
   }
   await this.claim(scope,'uploaded','submitting');
   await this.#jobs.transaction(scope,async(db,j)=>{await db.query("SET LOCAL idle_in_transaction_session_timeout='90s'");await publicationLocks(db,j.brand_id);const current=await this.request(db,j);if(current.phase!=='submitting')throw new PostizError('PUBLICATION_OUTCOME_UNKNOWN');const {a}=await this.validate(db,j,current);
    const remote=await this.client(scope,a).submitLinkedIn({integrationId:current.remote_channel_id,caption:current.caption,media:current.remote_media,scheduledAt:new Date(current.scheduled_at).toISOString()});
    await db.query("UPDATE app.publication_requests SET remote_post_id=$2,phase='accepted' WHERE job_id=$1",[j.id,remote.postId]);await this.#social.finish(db,j,'succeeded');
   });return 'accepted';
  }catch(e){
   if(!(e instanceof PostizError)&&!(e instanceof ConflictException))throw e;
   const error=e instanceof PostizError?e:new PostizError('PUBLICATION_APPROVAL_CHANGED');let retry=false;
   await this.#jobs.transaction(scope,async(db,j)=>{const r=await this.request(db,j);if(!r||terminal.has(j.status))return;
    if(error.outcome==='unknown'||error.code==='PUBLICATION_OUTCOME_UNKNOWN')return this.record(db,j,'unknown','failed','PUBLICATION_OUTCOME_UNKNOWN');
    if(error.outcome==='not_sent'&&transient(error)){retry=true;return this.record(db,j,r.phase==='uploading'?'queued':r.phase==='submitting'?'uploaded':r.phase,'retrying',error.code);}
    return this.record(db,j,error.code==='PUBLICATION_ACCESS_REVOKED'?'canceled':'rejected',error.code==='PUBLICATION_ACCESS_REVOKED'?'canceled':'rejected',error.code);
   });if(retry)throw new SocialReadRetry(error.retryAfterSeconds??30);return 'rejected';
  }
 }
 async claim(scope:JobScope,from:string,to:string){return this.#jobs.transaction(scope,async(db,j)=>{await publicationLocks(db,j.brand_id);const r=await this.request(db,j);if(r.phase!==from||terminal.has(j.status))throw new PostizError('PUBLICATION_OUTCOME_UNKNOWN');await this.validate(db,j,r);await db.query('UPDATE app.publication_requests SET phase=$2 WHERE job_id=$1',[j.id,to]);});}
 async reconcile(scope:JobScope):Promise<{state:string;scheduledAt?:string}>{
  try{
   const input=await this.#jobs.transaction(scope,async(db,j)=>{const r=await this.request(db,j);if(!r||r.phase!=='accepted'||!r.remote_post_id)throw new PostizError('PUBLICATION_NOT_ACKNOWLEDGED');if(!await this.#social.permitted(db,j))throw new PostizError('PUBLICATION_ACCESS_REVOKED');return {r,a:await this.account(db,r)};});
   const date=new Date(input.r.scheduled_at).getTime(),posts=await this.client(scope,input.a).listPosts(new Date(date-86400000).toISOString(),new Date(date+86400000).toISOString());
   const matches=posts.filter(p=>p.id===input.r.remote_post_id);if(matches.length>1)throw new PostizError('POSTIZ_RESPONSE_INVALID');const p=matches[0];
   if(p&&(p.integrationId!==input.r.remote_channel_id||p.provider!=='linkedin'||p.content!==input.r.caption||Date.parse(p.publishDate)!==date))throw new PostizError('PUBLICATION_REMOTE_CHANGED');
   return this.#jobs.transaction(scope,async(db,j)=>{await publicationLocks(db,j.brand_id);const r=await this.request(db,j);if(!await this.#social.permitted(db,j))throw new PostizError('PUBLICATION_ACCESS_REVOKED');await this.account(db,r);if(r.remote_post_id!==input.r.remote_post_id)throw new PostizError('PUBLICATION_REMOTE_CHANGED');
    const state=p?.state??'missing';await db.query('INSERT INTO app.publication_observations(id,organization_id,brand_id,publication_id,job_id,state,release_id,release_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),j.organization_id,j.brand_id,r.job_id,j.id,state,p?.releaseId??null,p?.releaseURL??null]);await db.query('UPDATE app.publication_requests SET observed_state=$2,release_id=$3,release_url=$4,last_checked_at=now(),check_error=NULL WHERE job_id=$1',[r.job_id,state,p?.releaseId??null,p?.releaseURL??null]);if(j.kind==='social.reconcile')await this.#social.finish(db,j,'succeeded');return {state,scheduledAt:new Date(r.scheduled_at).toISOString()};
   });
  }catch(e){if(!(e instanceof PostizError))throw e;await this.#jobs.transaction(scope,async(db,j)=>{const r=await this.request(db,j);if(r)await db.query('UPDATE app.publication_requests SET check_error=$2 WHERE job_id=$1',[r.job_id,e.code]);if(j.kind==='social.reconcile')await this.#social.finish(db,j,transient(e)?'retrying':'rejected',e.code);});if(transient(e))throw new SocialReadRetry(e.retryAfterSeconds??30);return {state:'check_failed'};}
 }
 fail(scope:JobScope){return this.#jobs.transaction(scope,async(db,j)=>{if(j.kind==='social.reconcile')return this.#social.finish(db,j,'failed','PUBLICATION_CHECK_UNAVAILABLE');const r=await this.request(db,j);if(!r||terminal.has(j.status))return j.status;return this.record(db,j,['uploading','submitting','unknown'].includes(r.phase)?'unknown':'rejected','failed','PUBLICATION_PROCESSING_UNAVAILABLE');});}
}
