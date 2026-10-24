import {AssetJobs,type JobScope} from './jobs.js';
import {PostizClient,PostizError,type PostizConfig} from './postiz-client.js';
import {PostizProvisioner,provisionedName} from './postiz-provisioner.js';
import {PostizVault} from './postiz-vault.js';
import {SocialJobs,SocialReadRetry} from './social-jobs.js';
import {hash} from './brand-brain.js';
export type ProvisioningConfig={client:PostizConfig;encryptionKey:string;signingSecret:string};
const terminal=new Set(['succeeded','failed','rejected','canceled']);
export class SocialProvisioningJobs {
 #jobs:AssetJobs;#client:PostizConfig;#vault:PostizVault;#provider:PostizProvisioner;#permission:SocialJobs;
 constructor(jobs:AssetJobs,config:ProvisioningConfig){this.#jobs=jobs;this.#client=config.client;this.#vault=new PostizVault(config.encryptionKey);this.#provider=new PostizProvisioner(config.client,config.signingSecret);this.#permission=new SocialJobs(jobs);}
 private async finish(db:any,j:any,phase:string,error:string|null=null){await db.query('UPDATE app.social_provisioning SET phase=$2 WHERE job_id=$1',[j.id,phase]);await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,phase==='unknown'?'failed':phase,error]);return phase;}
 async run(scope:JobScope):Promise<string>{
  const input=await this.#jobs.transaction(scope,async(db,j)=>{
   if(j.kind!=='social.provision')throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return null;
   let p=(await db.query('SELECT * FROM app.social_provisioning WHERE job_id=$1',[j.id])).rows[0];
   if(!p){const recovery=(await db.query('SELECT source_job_id FROM app.social_provision_checks WHERE job_id=$1',[j.id])).rows[0];
    if(recovery){const saved=(await db.query('SELECT * FROM app.social_provisioning WHERE job_id=$1',[recovery.source_job_id])).rows[0];
     if(!saved||saved.phase!=='unknown'||!saved.candidate_saved){await this.finish(db,j,'unknown','POSTIZ_RECOVERY_CANDIDATE_UNAVAILABLE');return null;}
     p={...saved,phase:'verifying'};
    }
   }if(!p)throw new Error('PROVISIONING_SCOPE_DENIED');
   if(p.phase==='creating'){await this.finish(db,j,'unknown','POSTIZ_PROVISIONING_OUTCOME_UNKNOWN');return null;}
   if(!await this.#permission.permitted(db,j)){await this.finish(db,j,p.remote_organization_id?'unknown':'canceled','SOCIAL_ACCESS_REVOKED');return null;}
   if(!['queued','verifying'].includes(p.phase))throw new Error('PROVISIONING_STATE_INVALID');
   const account=(await db.query('SELECT * FROM app.postiz_accounts')).rows[0];if(account){await this.finish(db,j,'unknown','POSTIZ_BINDING_ALREADY_EXISTS');return null;}
   await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);
   if(p.phase==='queued')await db.query("UPDATE app.social_provisioning SET phase='creating' WHERE job_id=$1",[j.id]);return p;
  });if(!input)return 'finished';
  try{
   let candidate=input;
   if(input.phase==='queued'){
    const created=await this.#provider.create(scope.brandId,scope.jobId),credentialScope={organization_id:scope.organizationId,brand_id:scope.brandId,remote_organization_id:created.id,revision:1};
    const encrypted=this.#vault.seal(credentialScope,created.apiKey),fingerprint=hash(created.apiKey);
    const recorded=await this.#jobs.transaction(scope,async(db,j)=>{
     const p=(await db.query('SELECT phase FROM app.social_provisioning WHERE job_id=$1',[j.id])).rows[0];
     // Preserve returned credentials even after a concurrent unknown-outcome
     // finalization, but never silently re-enable such a held attempt.
     if(!['creating','unknown'].includes(p.phase))return false;
     await db.query("UPDATE app.social_provisioning SET phase=$2,remote_organization_id=$3,encrypted_credential=$4,credential_fingerprint=$5 WHERE job_id=$1",[j.id,p.phase==='creating'?'verifying':'unknown',created.id,encrypted,fingerprint]);return p.phase==='creating'&&!terminal.has(j.status);
    });if(!recorded)return 'finished';candidate={...input,...credentialScope,encrypted_credential:encrypted,credential_fingerprint:fingerprint};
   }
   const allowed=await this.#jobs.transaction(scope,async(db,j)=>{if(terminal.has(j.status))return false;if(!await this.#permission.permitted(db,j)){await this.finish(db,j,'unknown','SOCIAL_ACCESS_REVOKED');return false;}return true;});if(!allowed)return 'finished';
   const client=new PostizClient(this.#client,{organizationId:scope.organizationId,brandId:scope.brandId,remoteOrganizationId:candidate.remote_organization_id,apiKey:this.#vault.open({...candidate,revision:1},candidate.encrypted_credential)}),identity=await client.identity();
   if(identity.name!==provisionedName(scope.brandId))throw new PostizError('POSTIZ_BUSINESS_IDENTITY_MISMATCH','unknown');
   return await this.#jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;if(!await this.#permission.permitted(db,j))return this.finish(db,j,'unknown','SOCIAL_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`social:${scope.brandId}`]);
    await db.query('INSERT INTO app.postiz_accounts(organization_id,brand_id,remote_organization_id,encrypted_credential,credential_fingerprint,revision,enabled,identity_verified_at) VALUES($1,$2,$3,$4,$5,1,true,now())',[scope.organizationId,scope.brandId,candidate.remote_organization_id,candidate.encrypted_credential,candidate.credential_fingerprint]);
    return this.finish(db,j,'succeeded');
   });
  }catch(error){if(!(error instanceof PostizError))throw error;
   const result=await this.#jobs.transaction(scope,async(db,j)=>{if(terminal.has(j.status))return j.status;const p=(await db.query('SELECT phase,remote_organization_id FROM app.social_provisioning WHERE job_id=$1',[j.id])).rows[0]??input;
    if(p.phase==='verifying'&&['POSTIZ_TIMEOUT','POSTIZ_NETWORK_ERROR','POSTIZ_UNAVAILABLE','POSTIZ_RATE_LIMITED'].includes(error.code)){await db.query("UPDATE app.jobs SET status='retrying',error_code=$2,updated_at=now() WHERE id=$1",[j.id,error.code]);return 'retrying';}
    return this.finish(db,j,p.remote_organization_id||error.outcome==='unknown'?'unknown':'rejected',error.code);
   });if(result==='retrying')throw new SocialReadRetry(error.retryAfterSeconds??30);return result;
  }
 }
 fail(scope:JobScope){return this.#jobs.transaction(scope,async(db,j)=>{if(j.kind!=='social.provision')throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return j.status;const p=(await db.query('SELECT phase FROM app.social_provisioning WHERE job_id=$1',[j.id])).rows[0];return this.finish(db,j,p?.phase==='queued'?'rejected':'unknown','POSTIZ_PROVISIONING_UNRESOLVED');});}
}
