import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SocialConnections} from './social-connections.js';
import {uuid} from './workspaces.js';
export class SocialProvisioning {
 constructor(readonly connections:SocialConnections,readonly enabled:boolean){}
 prepare(user:string,brand:string,key:unknown){if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Include a valid request key');return this.connections.scope(user,brand,true,async(db,b)=>{
  if(!this.enabled||!this.connections.enabled)throw new ConflictException('Social account setup is not available yet');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${brand.toLowerCase()}`]);
  const account=(await db.query('SELECT enabled,identity_verified_at FROM app.postiz_accounts')).rows[0];if(account){if(!account.enabled||!account.identity_verified_at)throw new ConflictException('This business requires an operator connection check');return {configured:true,job:null};}
  const prior=(await db.query("SELECT p.job_id AS id,p.phase,j.status,j.error_code FROM app.social_provisioning p JOIN app.jobs j ON j.id=p.job_id WHERE p.request_key=$1 OR p.phase NOT IN ('rejected','canceled') ORDER BY p.created_at DESC LIMIT 1",[key])).rows[0];if(prior)return {configured:false,job:prior};
  if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='social.provision' AND created_at>now()-interval '1 hour'")).rows[0].n>=3)throw new ConflictException('Account setup limit reached. Try again later');
  const id=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.provision')",[id,b.organization_id,brand,user]);
  await db.query('INSERT INTO app.social_provisioning(job_id,organization_id,brand_id,request_key) VALUES($1,$2,$3,$4)',[id,b.organization_id,brand,key]);
  await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.provision')",[id,b.organization_id,brand]);return {configured:false,job:{id,phase:'queued',status:'queued',error_code:null}};
 });}
 recheck(user:string,brand:string,source:string,key:unknown){source=uuid(source);if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Include a valid request key');return this.connections.scope(user,brand,true,async(db,b)=>{
  if(!this.enabled||!this.connections.enabled)throw new ConflictException('Social account setup is not available');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${brand.toLowerCase()}`]);
  const prior=(await db.query('SELECT r.job_id AS id,r.source_job_id,j.requested_by,j.status FROM app.social_provision_checks r JOIN app.jobs j ON j.id=r.job_id WHERE r.request_key=$1',[key])).rows[0];
  if(prior){if(prior.source_job_id!==source||prior.requested_by!==user)throw new ConflictException('This request key belongs to another verification');return {id:prior.id,status:prior.status};}
  if((await db.query('SELECT 1 FROM app.postiz_accounts')).rowCount)throw new ConflictException('This business already has an account binding');
  const saved=(await db.query('SELECT p.phase,p.candidate_saved,j.status FROM app.social_provisioning p JOIN app.jobs j ON j.id=p.job_id WHERE p.job_id=$1',[source])).rows[0];
  if(!saved)throw new NotFoundException('Account setup not found');
  if(saved.phase!=='unknown'||!saved.candidate_saved||!['failed','rejected','canceled'].includes(saved.status))throw new ConflictException('No saved account is available for verification. Operator recovery is required');
  const active=(await db.query("SELECT id,status FROM app.jobs WHERE kind='social.provision' AND status IN ('queued','running','retrying')")).rows[0];if(active)return active;
  if((await db.query("SELECT count(*)::int AS n FROM app.social_provision_checks WHERE created_at>now()-interval '1 hour'")).rows[0].n>=3)throw new ConflictException('Verification check limit reached. Try again later');
  const id=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.provision')",[id,b.organization_id,brand,user]);
  await db.query('INSERT INTO app.social_provision_checks(job_id,organization_id,brand_id,source_job_id,request_key) VALUES($1,$2,$3,$4,$5)',[id,b.organization_id,brand,source,key]);
  await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.provision')",[id,b.organization_id,brand]);return {id,status:'queued'};
 });}
 cancel(user:string,brand:string,job:string){job=uuid(job);return this.connections.scope(user,brand,true,async db=>{const j=(await db.query("SELECT status FROM app.jobs WHERE id=$1 AND kind='social.provision'",[job])).rows[0];if(!j)throw new NotFoundException('Account setup not found');if(!['queued','running','retrying'].includes(j.status))throw new ConflictException('This setup attempt already finished');await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[job]);return {id:job,cancel_requested:true};});}
}
