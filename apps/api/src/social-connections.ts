import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Businesses} from './businesses.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {uuid} from './workspaces.js';
export class SocialConnections {
 constructor(readonly businesses:Businesses,readonly enabled:boolean,readonly features:{provisioning:boolean;authorization:boolean}={provisioning:false,authorization:false}){}
 async scope<T>(user:string,id:string,write:boolean,action:(db:any,b:any)=>Promise<T>){const b=await this.businesses.resolve(user,id);return this.businesses.database.transaction(user,b.organization_id,write,async db=>{if(write&&!(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed)throw new ForbiddenException('Only a business owner or administrator can manage social connections');return action(db,b);},id);}
 read(user:string,id:string,session?:string){return this.scope(user,id,false,async(db,b)=>{
  const can_manage=(await db.query('SELECT app.social_manager($1,$2) AS allowed',[b.organization_id,id])).rows[0].allowed;
  if(session)await db.query("SELECT set_config('app.oauth_session',$1,true)",[uuid(session)]);
  const authorization=session?(await db.query('SELECT id,phase,expires_at FROM app.social_authorizations ORDER BY created_at DESC LIMIT 1')).rows[0]??null:null;
  const account=(await db.query('SELECT revision,enabled,identity_verified_at FROM app.postiz_accounts WHERE brand_id=$1',[id])).rows[0];
  const channels=(await db.query('SELECT id,provider,name,profile,(internal_id IS NOT NULL AND provider=\'linkedin\') AS can_reconnect,publishing_held,observed_state,token_health,last_seen_at,last_checked_at FROM app.social_channels ORDER BY provider,name,id')).rows;
  const jobs=(await db.query("SELECT id,status,error_code,cancel_requested,created_at,updated_at FROM app.jobs WHERE kind='social.sync' ORDER BY created_at DESC LIMIT 20")).rows;
  const provisioning=(await db.query(`SELECT COALESCE(r.job_id,p.job_id) AS id,p.job_id AS source_id,
   CASE WHEN r.job_id IS NULL THEN p.phase WHEN j.status IN ('running','retrying') THEN 'verifying' WHEN j.status='failed' THEN 'unknown' ELSE j.status END AS phase,
   j.status,j.error_code,j.cancel_requested,
   (p.phase='unknown' AND p.candidate_saved AND j.status IN ('failed','rejected','canceled')) AS can_recheck
   FROM app.social_provisioning p
   LEFT JOIN LATERAL (SELECT job_id FROM app.social_provision_checks WHERE source_job_id=p.job_id ORDER BY created_at DESC LIMIT 1) r ON true
   JOIN app.jobs j ON j.id=COALESCE(r.job_id,p.job_id) ORDER BY p.created_at DESC LIMIT 1`)).rows[0]??null;
  if(provisioning)provisioning.can_recheck=provisioning.can_recheck&&can_manage&&this.enabled&&this.features.provisioning&&!account;
  return {can_manage,authorization,setup_available:this.enabled&&this.features.provisioning&&this.features.authorization&&!account,authorization_available:this.enabled&&this.features.authorization&&!!account?.enabled&&!!account.identity_verified_at,setup_status:!this.enabled?'unavailable':account?.enabled&&account.identity_verified_at?'ready':account?'disabled':'not_prepared',provisioning,configured:this.enabled&&!!account?.enabled&&!!account?.identity_verified_at,channels,jobs};
 });}
 refresh(user:string,id:string,key:unknown){if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Include a valid request key');return this.scope(user,id,true,async(db,b)=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${id.toLowerCase()}`]);
  const account=(await db.query('SELECT revision,enabled,identity_verified_at FROM app.postiz_accounts WHERE brand_id=$1',[id])).rows[0];
  if(!this.enabled||!account?.enabled||!account.identity_verified_at)throw new ConflictException('Social publishing has not been configured for this business');
  const fingerprint=hash(canonicalJSON({user,revision:account.revision}));
  const prior=(await db.query('SELECT j.id,j.status,r.request_hash FROM app.social_sync_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.request_key=$1',[key])).rows[0];if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('This request key belongs to a different connection check');return {id:prior.id,status:prior.status};}
  const active=(await db.query("SELECT id,status FROM app.jobs WHERE kind='social.sync' AND status IN ('queued','running','retrying')")).rows[0];if(active)return active;
  if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='social.sync' AND created_at>now()-interval '1 hour'")).rows[0].n>=30)throw new ConflictException('Connection check limit reached. Try again later');
  const job=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.sync')",[job,b.organization_id,id,user]);
  await db.query('INSERT INTO app.social_sync_requests(job_id,organization_id,brand_id,account_revision,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[job,b.organization_id,id,account.revision,key,fingerprint]);
  await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.sync')",[job,b.organization_id,id]);return {id:job,status:'queued'};
 });}
 disconnect(user:string,id:string,channelId:string,key:unknown,body:any){channelId=uuid(channelId);if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Include a valid request key');if(body?.confirmHistoryRemoval!==true)throw new BadRequestException('Confirm removal of this account and its Postiz post history');return this.scope(user,id,true,async(db,b)=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${id.toLowerCase()}`]);
  const account=(await db.query('SELECT revision,enabled,identity_verified_at FROM app.postiz_accounts')).rows[0];if(!this.enabled||!account?.enabled||!account.identity_verified_at)throw new ConflictException('Social connections are not configured');
  const channel=(await db.query('SELECT * FROM app.social_channels WHERE id=$1',[channelId])).rows[0];if(!channel)throw new NotFoundException('Social account not found');
  const fingerprint=hash(canonicalJSON({user,revision:account.revision,disconnect:channelId}));
  const prior=(await db.query('SELECT job_id,request_hash FROM app.social_sync_requests WHERE request_key=$1',[key])).rows[0];if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('Request key already used');return {id:prior.job_id};}
  if((await db.query("SELECT 1 FROM app.jobs WHERE kind IN ('social.authorize','social.connect','social.sync') AND status IN ('queued','running','retrying')")).rowCount)throw new ConflictException('Wait for the current connection operation to finish');
  if((await db.query("SELECT 1 FROM app.publication_requests WHERE channel_id=$1 AND (phase IN ('queued','uploading','uploaded','submitting','unknown') OR phase='accepted' AND observed_state NOT IN ('published','failed'))",[channelId])).rowCount)throw new ConflictException('Resolve or cancel pending publications before disconnecting this account');
  if((await db.query("SELECT 1 FROM app.social_disconnects WHERE channel_id=$1 AND phase NOT IN ('absent','rejected')",[channelId])).rowCount)throw new ConflictException('Removal is already requested. Refresh accounts to check its outcome');
  const job=randomUUID();await db.query('UPDATE app.social_channels SET publishing_held=true WHERE id=$1',[channelId]);
  await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.sync')",[job,b.organization_id,id,user]);
  await db.query('INSERT INTO app.social_sync_requests(job_id,organization_id,brand_id,account_revision,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6)',[job,b.organization_id,id,account.revision,key,fingerprint]);
  await db.query('INSERT INTO app.social_disconnects(job_id,organization_id,brand_id,channel_id,remote_id) VALUES($1,$2,$3,$4,$5)',[job,b.organization_id,id,channelId,channel.remote_id]);
  await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.sync')",[job,b.organization_id,id]);return {id:job};
 });}
 cancel(user:string,id:string,jobId:string){jobId=uuid(jobId);return this.scope(user,id,true,async db=>{const j=(await db.query("SELECT status FROM app.jobs WHERE id=$1 AND kind='social.sync'",[jobId])).rows[0];if(!j)throw new NotFoundException('Connection check not found');if(!['queued','running','retrying'].includes(j.status))throw new ConflictException('This check already finished');await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[jobId]);return {id:jobId,cancel_requested:true};});}
}
