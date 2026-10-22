import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {SocialConnections} from './social-connections.js';
import {OAuthSecrets} from './oauth-secrets.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {uuid} from './workspaces.js';
export class SocialOAuth {
 #secrets?:OAuthSecrets;
 constructor(readonly connections:SocialConnections,key?:string){if(key)this.#secrets=new OAuthSecrets(key);}
 private scoped<T>(user:string,session:string,brand:string,action:(db:any,b:any)=>Promise<T>){session=uuid(session);return this.connections.scope(user,brand,true,async(db,b)=>{await db.query("SELECT set_config('app.oauth_session',$1,true)",[session]);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${brand.toLowerCase()}`]);return action(db,b);});}
 private async account(db:any){const a=(await db.query('SELECT revision,enabled,identity_verified_at FROM app.postiz_accounts')).rows[0];if(!this.connections.enabled||!this.#secrets||!a?.enabled||!a.identity_verified_at)throw new ConflictException('Social authorization is not configured for this business');return a;}
 start(user:string,session:string,brand:string,key:unknown){if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Include a valid request key');return this.scoped(user,session,brand,async(db,b)=>{
  const a=await this.account(db),prior=(await db.query('SELECT id,account_revision FROM app.social_authorizations WHERE request_key=$1',[key])).rows[0];if(prior){if(prior.account_revision!==a.revision)throw new ConflictException('Connection settings changed. Start a new connection');return {id:prior.id};}
  if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='social.authorize' AND created_at>now()-interval '1 hour'")).rows[0].n>=10)throw new ConflictException('Connection attempt limit reached. Try again later');
  const id=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.authorize')",[id,b.organization_id,brand,user]);
  await db.query("INSERT INTO app.social_authorizations(id,organization_id,brand_id,requested_by,session_id,account_revision,provider,request_key) VALUES($1,$2,$3,$4,$5,$6,'linkedin',$7)",[id,b.organization_id,brand,user,session,a.revision,key]);
  await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.authorize')",[id,b.organization_id,brand]);return {id};
 });}
 read(user:string,session:string,brand:string,id:string){id=uuid(id);return this.scoped(user,session,brand,async db=>{
  const a=await this.account(db),r=(await db.query('SELECT id,phase,authorization_url,account_revision,expires_at FROM app.social_authorizations WHERE id=$1',[id])).rows[0];if(!r)throw new NotFoundException('Connection attempt not found');
  const c=(await db.query('SELECT c.job_id,c.phase,j.status,j.error_code FROM app.social_callbacks c JOIN app.jobs j ON j.id=c.job_id WHERE c.authorization_id=$1',[id])).rows[0];
  const j=(await db.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[id])).rows[0],expired=new Date(r.expires_at).getTime()<=Date.now(),changed=a.revision!==r.account_revision;
  return {id,provider:'linkedin',phase:c?.phase??(changed?'settings_changed':expired&&r.phase==='awaiting_consent'?'expired':r.phase),job:c?{id:c.job_id,status:c.status,error_code:c.error_code}:j,expires_at:r.expires_at,authorization_url:!c&&!expired&&!changed&&r.phase==='awaiting_consent'?r.authorization_url:null};
 });}
 callback(user:string,session:string,brand:string,id:string,body:any){id=uuid(id);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['state','code','denied','timezone'].includes(k)))throw new BadRequestException('Invalid authorization response');
  const {state,code,denied,timezone}=body;
  if(typeof state!=='string'||! /^[a-f0-9-]{36}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(state)||state.split('.')[0]!==brand.toLowerCase()||state.split('.')[1]!==id.toLowerCase()||typeof denied!=='boolean'||typeof timezone!=='string'||! /^-?\d{1,4}$/.test(timezone)||Math.abs(Number(timezone))>840||(!denied&&(typeof code!=='string'||!code||code.length>8000||/[\x00-\x1f\x7f]/.test(code)))||(denied&&code!==undefined))throw new BadRequestException('Invalid authorization response');
  return this.scoped(user,session,brand,async(db,b)=>{
   const account=await this.account(db),r=(await db.query('SELECT id,phase,state_hash,account_revision,expires_at FROM app.social_authorizations WHERE id=$1',[id])).rows[0];if(!r||hash(state)!==r.state_hash)throw new NotFoundException('Connection attempt not found');
   const fingerprint=hash(canonicalJSON({state,code:denied?null:code,denied,timezone})),prior=(await db.query('SELECT job_id,request_hash FROM app.social_callbacks WHERE authorization_id=$1',[id])).rows[0];if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('This authorization response was already used');return {id:prior.job_id};}
   if(account.revision!==r.account_revision||r.phase!=='awaiting_consent'||new Date(r.expires_at).getTime()<=Date.now())throw new ConflictException('This connection link expired or settings changed. Start again');
   const job=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.connect')",[job,b.organization_id,brand,user]);
   await db.query('INSERT INTO app.social_callbacks(job_id,organization_id,brand_id,authorization_id,state_hash,request_hash,encrypted_code,denied,timezone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,b.organization_id,brand,id,hash(state),fingerprint,denied?null:this.#secrets!.seal(`${b.organization_id}:${brand.toLowerCase()}:${id}`,'code',code),denied,timezone]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.connect')",[job,b.organization_id,brand]);return {id:job};
  });
 }
}
