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
  const channels=(await db.query('SELECT id,provider,name,profile,observed_state,token_health,last_seen_at,last_checked_at FROM app.social_channels ORDER BY provider,name,id')).rows;
  const jobs=(await db.query("SELECT id,status,error_code,cancel_requested,created_at,updated_at FROM app.jobs WHERE kind='social.sync' ORDER BY created_at DESC LIMIT 20")).rows;
  const provisioning=(await db.query('SELECT p.job_id AS id,p.phase,j.status,j.error_code,j.cancel_requested FROM app.social_provisioning p JOIN app.jobs j ON j.id=p.job_id ORDER BY p.created_at DESC LIMIT 1')).rows[0]??null;
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
 cancel(user:string,id:string,jobId:string){jobId=uuid(jobId);return this.scope(user,id,true,async db=>{const j=(await db.query("SELECT status FROM app.jobs WHERE id=$1 AND kind='social.sync'",[jobId])).rows[0];if(!j)throw new NotFoundException('Connection check not found');if(!['queued','running','retrying'].includes(j.status))throw new ConflictException('This check already finished');await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[jobId]);return {id:jobId,cancel_requested:true};});}
}
