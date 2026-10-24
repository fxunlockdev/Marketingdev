import {randomBytes,randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {PostizClient,PostizError} from './postiz-client.js';
import {PostizVault} from './postiz-vault.js';
import {OAuthSecrets} from './oauth-secrets.js';
import {SocialJobs,SocialReadRetry,type SocialWorkerConfig} from './social-jobs.js';
import {hash} from './brand-brain.js';
const terminal=new Set(['succeeded','failed','rejected','canceled']);
export class SocialOAuthJobs {
 #credentials?:PostizVault;#secrets?:OAuthSecrets;#permissions:SocialJobs;
 constructor(readonly jobs:AssetJobs,readonly config?:SocialWorkerConfig,secretKey?:string){if(config)this.#credentials=new PostizVault(config.encryptionKey);if(secretKey)this.#secrets=new OAuthSecrets(secretKey);this.#permissions=new SocialJobs(jobs,config);}
 private async records(db:any,j:any){const callback=j.kind==='social.connect'?(await db.query('SELECT * FROM app.social_callbacks WHERE job_id=$1',[j.id])).rows[0]:null;const authorization=(await db.query('SELECT * FROM app.social_authorizations WHERE id=$1',[callback?.authorization_id??j.id])).rows[0];return {callback,authorization};}
 private async permitted(db:any,j:any,a:any){return !!a&&await this.#permissions.permitted(db,j)&&(await db.query('SELECT app.oauth_session_live($1) AS live',[a.session_id])).rows[0].live;}
 private async finish(db:any,j:any,phase:string,code:string|null=null){
  const {callback,authorization}=await this.records(db,j);if(authorization)await db.query('UPDATE app.social_authorizations SET phase=$2,authorization_url=NULL,encrypted_state=NULL WHERE id=$1',[authorization.id,phase]);
  if(callback)await db.query('UPDATE app.social_callbacks SET phase=$2,encrypted_code=NULL WHERE job_id=$1',[j.id,phase]);
  const status=phase==='unknown'?'failed':phase;await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]);return phase;
 }
 private async check(db:any,j:any,a:any){
  if(!await this.permitted(db,j,a)){await this.finish(db,j,'canceled','SOCIAL_ACCESS_OR_SESSION_REVOKED');return null;}
  if((await db.query('SELECT 1 FROM app.social_disconnects WHERE created_at >= $1',[a.created_at])).rowCount){await this.finish(db,j,'rejected','SOCIAL_CONNECTION_REMOVAL_STARTED');return null;}
  const account=(await db.query('SELECT * FROM app.postiz_accounts')).rows[0];if(!this.config||!this.#credentials||!this.#secrets||!account?.enabled||!account.identity_verified_at||account.revision!==a.account_revision){await this.finish(db,j,'rejected','POSTIZ_ACCOUNT_CHANGED');return null;}return account;
 }
 private client(scope:JobScope,account:any){return new PostizClient(this.config!.client,{organizationId:scope.organizationId,brandId:scope.brandId,remoteOrganizationId:account.remote_organization_id,apiKey:this.#credentials!.open(account,account.encrypted_credential)});}
 async run(scope:JobScope):Promise<string>{
  const input=await this.jobs.transaction(scope,async(db,j)=>{
   if(!['social.authorize','social.connect'].includes(j.kind))throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return null;
   const {authorization:a,callback:c}=await this.records(db,j);const account=await this.check(db,j,a);if(!account)return null;
   // A prior activity may have reached Postiz. Never repeat an uncertain mutation.
   if(a.phase==='starting'||c?.phase==='exchanging'){await this.finish(db,j,'unknown','SOCIAL_AUTHORIZATION_OUTCOME_UNKNOWN');return null;}
   if(c?.phase!=='verifying'&&new Date(a.expires_at).getTime()<=Date.now()){await this.finish(db,j,'rejected','SOCIAL_AUTHORIZATION_EXPIRED');return null;}
   if(c?.denied){await this.finish(db,j,'canceled','SOCIAL_CONSENT_DECLINED');return null;}
   if(j.kind==='social.authorize'&&a.phase!=='queued'||j.kind==='social.connect'&&(!c||!['queued','verifying'].includes(c.phase)||a.phase!=='awaiting_consent')){await this.finish(db,j,'rejected','SOCIAL_AUTHORIZATION_INVALID');return null;}
   await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);
   if(j.kind==='social.authorize')await db.query("UPDATE app.social_authorizations SET phase='starting' WHERE id=$1",[a.id]);
   else if(c.phase==='queued')await db.query("UPDATE app.social_callbacks SET phase='exchanging' WHERE job_id=$1",[j.id]);
   return {j,a,c,account};
  });if(!input)return 'finished';
  const {j,a,c,account}=input,secretScope=`${scope.organizationId}:${scope.brandId}:${a.id}`;
  try{
   const client=this.client(scope,account);
   if(j.kind==='social.authorize'){
    const auth=await client.beginAuthorization(a.provider,a.target_internal_id??undefined),token=`${scope.brandId}.${a.id}.${randomBytes(32).toString('base64url')}`,url=new URL(auth.url);url.searchParams.set('state',token);
    return await this.jobs.transaction(scope,async(db,current)=>{if(terminal.has(current.status))return current.status;if(!await this.check(db,current,a))return 'finished';if(new Date(a.expires_at).getTime()<=Date.now())return this.finish(db,current,'rejected','SOCIAL_AUTHORIZATION_EXPIRED');
     await db.query("UPDATE app.social_authorizations SET phase='awaiting_consent',authorization_url=$2,state_hash=$3,encrypted_state=$4 WHERE id=$1",[a.id,url.href,hash(token),this.#secrets!.seal(secretScope,'state',auth.state)]);
     await db.query("UPDATE app.jobs SET status='succeeded',updated_at=now() WHERE id=$1",[j.id]);return 'awaiting_consent';
    });
   }
   let remoteId=c.remote_id,internalId=c.internal_id;
   if(c.phase!=='verifying'){
    const result=await client.completeAuthorization(a.provider,this.#secrets!.open(secretScope,'state',a.encrypted_state),this.#secrets!.open(secretScope,'code',c.encrypted_code),c.timezone);remoteId=result.id;internalId=result.internalId;
    if(a.target_remote_id&&(remoteId!==a.target_remote_id||internalId!==a.target_internal_id))throw new PostizError('POSTIZ_RECONNECT_IDENTITY_MISMATCH','unknown');
    // Persist the actual returned identity before any retryable read. A crash
    // before this commit leaves an uncertain result, never a second exchange.
    const recorded=await this.jobs.transaction(scope,async(db,current)=>{if(terminal.has(current.status))return false;if(!await this.check(db,current,a))return false;await db.query("UPDATE app.social_callbacks SET phase='verifying',remote_id=$2,internal_id=$3,encrypted_code=NULL WHERE job_id=$1",[j.id,remoteId,internalId]);return true;});if(!recorded)return 'finished';
   }
   const channels=await client.listIntegrations(),channel=channels.find(x=>x.id===remoteId&&x.provider===a.provider&&!x.disabled);
   if(!channel)throw new PostizError('POSTIZ_AUTHORIZED_ACCOUNT_UNCONFIRMED','unknown');
   return await this.jobs.transaction(scope,async(db,current)=>{if(terminal.has(current.status))return current.status;
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${scope.brandId}`]);if(!await this.check(db,current,a))return 'finished';
    await db.query(`INSERT INTO app.social_channels(id,organization_id,brand_id,remote_id,provider,name,profile,picture,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id,internal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'available',now(),now(),$9,$10,$11)
     ON CONFLICT(remote_id) DO UPDATE SET provider=EXCLUDED.provider,name=EXCLUDED.name,profile=EXCLUDED.profile,picture=EXCLUDED.picture,observed_state=EXCLUDED.observed_state,last_seen_at=EXCLUDED.last_seen_at,last_checked_at=EXCLUDED.last_checked_at,account_revision=EXCLUDED.account_revision,last_job_id=EXCLUDED.last_job_id,internal_id=EXCLUDED.internal_id,publishing_held=false`,[randomUUID(),scope.organizationId,scope.brandId,channel.id,channel.provider,channel.name,channel.profile,channel.picture,account.revision,j.id,internalId]);
    return this.finish(db,current,'succeeded');
   });
  }catch(error){
   if(!(error instanceof PostizError))throw error;
   return this.jobs.transaction(scope,async(db,current)=>{if(terminal.has(current.status))return current.status;const {callback}=await this.records(db,current);
    if(callback?.phase==='verifying'&&['POSTIZ_TIMEOUT','POSTIZ_NETWORK_ERROR','POSTIZ_UNAVAILABLE','POSTIZ_RATE_LIMITED'].includes(error.code)){await db.query("UPDATE app.jobs SET status='retrying',error_code=$2,updated_at=now() WHERE id=$1",[j.id,error.code]);return 'retrying';}
    return this.finish(db,current,error.outcome==='unknown'?'unknown':'rejected',error.code);
   }).then(result=>{if(result==='retrying')throw new SocialReadRetry(error.retryAfterSeconds??30);return result;});
  }
 }
 fail(scope:JobScope){return this.jobs.transaction(scope,async(db,j)=>{if(!['social.authorize','social.connect'].includes(j.kind))throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return j.status;const {authorization:a,callback:c}=await this.records(db,j);return this.finish(db,j,a?.phase==='starting'||c?.phase==='exchanging'||c?.phase==='verifying'?'unknown':'rejected','SOCIAL_AUTHORIZATION_UNRESOLVED');});}
}
