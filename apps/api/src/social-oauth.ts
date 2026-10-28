import {localMinute} from './local-calendar.js';
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
 start(user:string,session:string,brand:string,key:unknown,body:any={},provider:string='linkedin'){
  if(!['linkedin','instagram-standalone','facebook'].includes(provider))throw new BadRequestException('Unsupported social provider');
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='channelId'))throw new BadRequestException('Invalid connection request');
  const targetId=body.channelId===undefined?null:uuid(body.channelId);if(provider==='facebook'&&targetId)throw new BadRequestException('Start a new Facebook Page connection');if(typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Include a valid request key');return this.scoped(user,session,brand,async(db,b)=>{
  const a=await this.account(db);
  if((await db.query("SELECT 1 FROM app.social_disconnects WHERE phase NOT IN ('absent','rejected')")).rowCount)throw new ConflictException('Refresh accounts to resolve the pending disconnect before authorizing again');
  const target=targetId?(await db.query('SELECT remote_id,internal_id,provider,account_revision FROM app.social_channels WHERE id=$1',[targetId])).rows[0]:null;
  if(targetId&&!target)throw new NotFoundException('Social account not found');
  if(target&&(!target.internal_id||target.provider!==provider||target.account_revision!==a.revision))throw new ConflictException('This account needs a new connection before targeted reconnect is available');
  const prior=(await db.query('SELECT id,provider,account_revision,target_remote_id,target_internal_id FROM app.social_authorizations WHERE request_key=$1',[key])).rows[0];if(prior){if(prior.provider!==provider||prior.target_remote_id!==(target?.remote_id??null)||prior.target_internal_id!==(target?.internal_id??null))throw new ConflictException('This request key belongs to another account');if(prior.account_revision!==a.revision)throw new ConflictException('Connection settings changed. Start a new connection');return {id:prior.id};}
  if((await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE kind='social.authorize' AND created_at>now()-interval '1 hour'")).rows[0].n>=10)throw new ConflictException('Connection attempt limit reached. Try again later');
  const id=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.authorize')",[id,b.organization_id,brand,user]);
  await db.query("INSERT INTO app.social_authorizations(id,organization_id,brand_id,requested_by,session_id,account_revision,provider,request_key,target_remote_id,target_internal_id) VALUES($1,$2,$3,$4,$5,$6,$10,$7,$8,$9)",[id,b.organization_id,brand,user,session,a.revision,key,target?.remote_id??null,target?.internal_id??null,provider]);
  await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.authorize')",[id,b.organization_id,brand]);return {id};
 });}
 read(user:string,session:string,brand:string,id:string){id=uuid(id);return this.scoped(user,session,brand,async db=>{
  const a=await this.account(db),r=(await db.query('SELECT id,provider,phase,authorization_url,account_revision,expires_at FROM app.social_authorizations WHERE id=$1',[id])).rows[0];if(!r)throw new NotFoundException('Connection attempt not found');
  const c=(await db.query('SELECT c.job_id,c.phase,c.page_choices,EXISTS(SELECT 1 FROM app.social_page_selections s WHERE s.job_id=c.job_id) AS page_selected,j.status,j.error_code,j.cancel_requested FROM app.social_callbacks c JOIN app.jobs j ON j.id=c.job_id WHERE c.authorization_id=$1',[id])).rows[0];
  const j=(await db.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[id])).rows[0],expired=new Date(r.expires_at).getTime()<=Date.now(),changed=a.revision!==r.account_revision;
  return {id,provider:r.provider,phase:c&&['succeeded','unknown','rejected','canceled'].includes(c.phase)?c.phase:changed?'settings_changed':expired&&['awaiting_consent','awaiting_page'].includes(c?.phase??r.phase)?'expired':c?.phase==='awaiting_page'&&c.cancel_requested?'canceling':c?.phase==='awaiting_page'&&c.page_selected?'selecting_page':c?.phase??r.phase,job:c?{id:c.job_id,status:c.status,error_code:c.error_code}:j,expires_at:r.expires_at,pages:!expired&&!changed&&c?.phase==='awaiting_page'&&!c.page_selected&&!c.cancel_requested?c.page_choices:[],authorization_url:!c&&!expired&&!changed&&r.phase==='awaiting_consent'?r.authorization_url:null};
 });}
 callback(user:string,session:string,brand:string,id:string,body:any){id=uuid(id);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['state','code','denied','timezone','provider'].includes(k)))throw new BadRequestException('Invalid authorization response');
  const {state,code,denied,timezone,provider}=body;
  if(provider!==undefined&&!['linkedin','instagram-standalone','facebook'].includes(provider))throw new BadRequestException('Unsupported social provider');
  if(typeof state!=='string'||! /^[a-f0-9-]{36}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(state)||state.split('.')[0]!==brand.toLowerCase()||state.split('.')[1]!==id.toLowerCase()||typeof denied!=='boolean'||timezone!==undefined&&(typeof timezone!=='string'||! /^-?\d{1,4}$/.test(timezone)||Math.abs(Number(timezone))>840)||(!denied&&(typeof code!=='string'||!code||code.length>8000||/[\x00-\x1f\x7f]/.test(code)))||(denied&&code!==undefined))throw new BadRequestException('Invalid authorization response');
  return this.scoped(user,session,brand,async(db,b)=>{
   const account=await this.account(db),r=(await db.query('SELECT id,provider,phase,state_hash,account_revision,expires_at FROM app.social_authorizations WHERE id=$1',[id])).rows[0];if(!r||hash(state)!==r.state_hash||provider!==undefined&&provider!==r.provider)throw new NotFoundException('Connection attempt not found');
   const fingerprint=hash(canonicalJSON({state,code:denied?null:code,denied,timezone:timezone??null})),prior=(await db.query('SELECT job_id,request_hash FROM app.social_callbacks WHERE authorization_id=$1',[id])).rows[0];if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('This authorization response was already used');return {id:prior.job_id};}
   if(account.revision!==r.account_revision||r.phase!=='awaiting_consent'||new Date(r.expires_at).getTime()<=Date.now())throw new ConflictException('This connection link expired or settings changed. Start again');
   const zone=(await db.query('SELECT timezone FROM app.business_onboarding WHERE brand_id=$1',[brand])).rows[0]?.timezone??'UTC',minute=Math.floor(Date.now()/60000)*60000,offset=timezone??String((minute-Date.parse(localMinute(minute,zone)+'Z'))/60000);
   const job=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'social.connect')",[job,b.organization_id,brand,user]);
   await db.query('INSERT INTO app.social_callbacks(job_id,organization_id,brand_id,authorization_id,state_hash,request_hash,encrypted_code,denied,timezone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[job,b.organization_id,brand,id,hash(state),fingerprint,denied?null:this.#secrets!.seal(`${b.organization_id}:${brand.toLowerCase()}:${id}`,'code',code),denied,offset]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'social.connect')",[job,b.organization_id,brand]);return {id:job};
  });
 }
 cancelPageSelection(user:string,session:string,brand:string,id:string){
  id=uuid(id);return this.scoped(user,session,brand,async db=>{
   await this.account(db);
   const c=(await db.query(`SELECT c.job_id,c.phase,j.cancel_requested,EXISTS(SELECT 1 FROM app.social_page_selections s WHERE s.job_id=c.job_id) AS page_selected
    FROM app.social_callbacks c JOIN app.social_authorizations a ON a.id=c.authorization_id JOIN app.jobs j ON j.id=c.job_id
    WHERE a.id=$1 AND a.provider='facebook'`,[id])).rows[0];
   if(!c)throw new NotFoundException('Page selection not found');
   if(c.cancel_requested)return {id:c.job_id,cancel_requested:true};
   if(c.phase!=='awaiting_page'||c.page_selected)throw new ConflictException('This Page connection is already processing. Check its status before starting again');
   await db.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[c.job_id]);
   return {id:c.job_id,cancel_requested:true};
  });
 }

 selectPage(user:string,session:string,brand:string,id:string,body:any){
  id=uuid(id);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='page_id')||typeof body.page_id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(body.page_id))throw new BadRequestException('Choose an available Facebook Page');
  return this.scoped(user,session,brand,async(db,b)=>{
   const account=await this.account(db),a=(await db.query('SELECT provider,account_revision,expires_at FROM app.social_authorizations WHERE id=$1',[id])).rows[0];
   if(!a||a.provider!=='facebook')throw new NotFoundException('Connection attempt not found');
   const c=(await db.query('SELECT c.job_id,c.phase,c.page_choices,j.cancel_requested FROM app.social_callbacks c JOIN app.jobs j ON j.id=c.job_id WHERE c.authorization_id=$1',[id])).rows[0];
   if(!c)throw new ConflictException('Complete Facebook sign-in first');
   const prior=(await db.query('SELECT page_id FROM app.social_page_selections WHERE job_id=$1',[c.job_id])).rows[0];
   if(prior){if(prior.page_id!==body.page_id)throw new ConflictException('A different Page was already selected. Start a new connection to change it');return {id:c.job_id};}
   if(c.cancel_requested||account.revision!==a.account_revision||new Date(a.expires_at).getTime()<=Date.now()||c.phase!=='awaiting_page')throw new ConflictException('This connection expired or changed. Start again');
   if(!c.page_choices.some((p:any)=>p.id===body.page_id))throw new BadRequestException('Choose an available Facebook Page');
   await db.query('INSERT INTO app.social_page_selections(job_id,organization_id,brand_id,page_id) VALUES($1,$2,$3,$4)',[c.job_id,b.organization_id,brand,body.page_id]);
   return {id:c.job_id};
  });
 }

}
