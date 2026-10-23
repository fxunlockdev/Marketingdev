import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {PostizClient,PostizError,type PostizConfig} from './postiz-client.js';
import {PostizVault} from './postiz-vault.js';
export type SocialWorkerConfig={client:PostizConfig;encryptionKey:string};
export class SocialReadRetry extends Error {constructor(readonly delaySeconds:number){super('SOCIAL_READ_UNAVAILABLE');}}
const terminal=new Set(['succeeded','failed','rejected','canceled']);
export class SocialJobs {
 #vault?:PostizVault;
 constructor(readonly jobs:AssetJobs,readonly config?:SocialWorkerConfig){if(config)this.#vault=new PostizVault(config.encryptionKey);}
 finish(db:any,j:any,status:string,code:string|null=null){return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]).then(()=>status);}
 async permitted(db:any,j:any){if(!await this.jobs.permitted(db,j))return false;const member=(await db.query('SELECT role,business_scope FROM app.memberships WHERE organization_id=$1 AND user_id=$2 AND active',[j.organization_id,j.requested_by])).rows[0];if(!member)return false;if(member.business_scope==='selected')return (await db.query("SELECT 1 FROM app.business_memberships WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3 AND active AND role='admin'",[j.organization_id,j.brand_id,j.requested_by])).rowCount===1;return ['owner','admin'].includes(member.role);}
 async run(scope:JobScope):Promise<string>{
  try{
   const input=await this.jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='social.sync')throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return null;
    if(!await this.permitted(db,j)){await this.finish(db,j,'canceled','SOCIAL_ACCESS_REVOKED');return null;}
    if(!this.config||!this.#vault)throw new PostizError('POSTIZ_NOT_CONFIGURED');
    const request=(await db.query('SELECT account_revision FROM app.social_sync_requests WHERE job_id=$1',[j.id])).rows[0],account=(await db.query('SELECT * FROM app.postiz_accounts')).rows[0];
    if(!request||!account||!account.enabled||!account.identity_verified_at||account.revision!==request.account_revision)throw new PostizError('POSTIZ_ACCOUNT_CHANGED');
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);return account;
   });
   if(!input)return 'finished';
   const client=new PostizClient(this.config!.client,{organizationId:scope.organizationId,brandId:scope.brandId,remoteOrganizationId:input.remote_organization_id,apiKey:this.#vault!.open(input,input.encrypted_credential)});
   const channels=await client.listIntegrations();
   return this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;if(!await this.permitted(db,j))return this.finish(db,j,'canceled','SOCIAL_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${j.brand_id}`]);
    const account=(await db.query('SELECT revision,enabled FROM app.postiz_accounts')).rows[0];if(!account?.enabled||account.revision!==input.revision)return this.finish(db,j,'rejected','POSTIZ_ACCOUNT_CHANGED');
    // Do not clear previous knowledge on a failed read. A successful empty list
    // means previously observed channels are now missing, not healthy/connected.
    await db.query("UPDATE app.social_channels SET observed_state='missing',last_checked_at=now(),last_job_id=$1 WHERE brand_id=$2",[j.id,j.brand_id]);
    for(const c of channels)await db.query(`INSERT INTO app.social_channels(id,organization_id,brand_id,remote_id,provider,name,profile,picture,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),$10,$11)
      ON CONFLICT(remote_id) DO UPDATE SET provider=EXCLUDED.provider,name=EXCLUDED.name,profile=EXCLUDED.profile,picture=EXCLUDED.picture,observed_state=EXCLUDED.observed_state,last_seen_at=EXCLUDED.last_seen_at,last_checked_at=EXCLUDED.last_checked_at,account_revision=EXCLUDED.account_revision,last_job_id=EXCLUDED.last_job_id`,[randomUUID(),j.organization_id,j.brand_id,c.id,c.provider,c.name,c.profile,c.picture,c.disabled?'disabled':'available',input.revision,j.id]);
    return this.finish(db,j,'succeeded');
   });
  }catch(error){if(!(error instanceof PostizError))throw error;
   const retryable=['POSTIZ_TIMEOUT','POSTIZ_NETWORK_ERROR','POSTIZ_UNAVAILABLE','POSTIZ_RATE_LIMITED'].includes(error.code);
   await this.jobs.transaction(scope,async(db,j)=>{if(terminal.has(j.status))return;if(!await this.permitted(db,j))return this.finish(db,j,'canceled','SOCIAL_ACCESS_REVOKED');await this.finish(db,j,retryable?'retrying':'rejected',error.code);});
   if(retryable)throw new SocialReadRetry(error.retryAfterSeconds??30);return 'rejected';
  }
 }
 fail(scope:JobScope){return this.jobs.transaction(scope,(db,j)=>{if(j.kind!=='social.sync')throw new Error('JOB_KIND_DENIED');return terminal.has(j.status)?j.status:this.finish(db,j,'failed','SOCIAL_CHECK_RETRIES_EXHAUSTED');});}
}
