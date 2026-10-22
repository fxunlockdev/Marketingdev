import {Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {Client,WorkflowExecutionAlreadyStartedError,WorkflowIdReusePolicy} from '@temporalio/client';
import {ObjectStore,InvalidAsset,digest} from './object-store.js';
import {MalwareScanner,validateFormat} from './file-validation.js';
export type JobScope={organizationId:string;brandId:string;jobId:string};
const terminal=new Set(['succeeded','rejected','failed','canceled']);
export async function assertJobRole(pool:Pool,expected:string){
  const {rows:[role]}=await pool.query(`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
  if(role.name!==expected||role.rolsuper||role.rolbypassrls)throw new Error('Unsafe job database role');
  const owned=await pool.query(`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','auth','delivery') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`);
  if(owned.rowCount)throw new Error('Job role must not own tables');
}
export class AssetJobs {
  constructor(readonly pool:Pool,readonly store:ObjectStore,readonly scanner:MalwareScanner){}
  async transaction<T>(scope:JobScope,action:(db:PoolClient,job:any)=>Promise<T>){
    const db=await this.pool.connect();try{
      await db.query('BEGIN');
      await db.query(`SELECT set_config('app.org_id',$1,true),set_config('app.brand_id',$2,true),set_config('app.job_id',$3,true)`,[scope.organizationId,scope.brandId,scope.jobId]);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${scope.organizationId}`]);
      const {rows:[job]}=await db.query('SELECT * FROM app.jobs WHERE id=$1 FOR UPDATE',[scope.jobId]);
      if(!job)throw new Error('JOB_SCOPE_DENIED');
      const value=await action(db,job);await db.query('COMMIT');return value;
    }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  async permitted(db:PoolClient,job:any){
    if(job.cancel_requested)return false;
    const {rows:[member]}=await db.query('SELECT role,business_scope FROM app.memberships WHERE organization_id=$1 AND user_id=$2 AND active',[job.organization_id,job.requested_by]);
    if(!member||member.role==='viewer')return false;
    if(member.business_scope==='selected'){const grant=(await db.query('SELECT role FROM app.business_memberships WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3 AND active',[job.organization_id,job.brand_id,job.requested_by])).rows[0];return !!grant&&grant.role!=='viewer';}
    return true;
  }
  async finish(db:PoolClient,job:any,status:string,code:string|null=null,scanner:string|null=null,etag:string|null=null){
    await db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[job.id,status,code]);
    await db.query('UPDATE app.assets SET state=$2,error_code=$3,scanner_version=COALESCE($4,scanner_version),etag=COALESCE($5,etag),updated_at=now() WHERE id=$1',[job.asset_id,status==='succeeded'?'ready':status,code,scanner,etag]);
    return status;
  }
  async validate(scope:JobScope):Promise<string>{
    const asset=await this.transaction(scope,async(db,job)=>{
      if(job.kind!=='asset.validate')throw new Error('JOB_KIND_DENIED');
      if(terminal.has(job.status))return null;
      if(!await this.permitted(db,job)){await this.finish(db,job,'canceled','ACCESS_REVOKED_OR_CANCELED');return null;}
      await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[job.id]);
      await db.query("UPDATE app.assets SET state='validating',error_code=NULL,updated_at=now() WHERE id=$1",[job.asset_id]);
      return (await db.query('SELECT * FROM app.assets WHERE id=$1',[job.asset_id])).rows[0];
    });
    if(!asset)return 'finished';
    try{
      const bytes=await this.store.read(asset.quarantine_key);
      if(bytes.length!==asset.expected_bytes)throw new InvalidAsset('SIZE_MISMATCH');
      if(digest(bytes)!==asset.sha256)throw new InvalidAsset('CHECKSUM_MISMATCH');
      const scanner=await this.scanner.scan(bytes);await validateFormat(bytes,asset.content_type);
      // Persist immutable bytes that were actually scanned; never promote a mutable upload key.
      const etag=await this.store.persist(asset.canonical_key,bytes,asset.content_type,asset.sha256);
      const result=await this.transaction(scope,async(db,job)=>{
        if(terminal.has(job.status))return job.status;
        if(!await this.permitted(db,job))return this.finish(db,job,'canceled','ACCESS_REVOKED_OR_CANCELED');
        return this.finish(db,job,'succeeded',null,scanner,etag);
      });
      // Cleanup is best effort; canonical success must not be undone by a cleanup outage.
      try{await this.store.removeQuarantine(asset.quarantine_key);}catch{}
      return result;
    }catch(error){
      const invalid=error instanceof InvalidAsset,code=invalid?error.code:'VALIDATION_SERVICE_UNAVAILABLE';
      const status=await this.transaction(scope,async(db,job)=>{
        if(terminal.has(job.status))return job.status;
        if(!await this.permitted(db,job))return this.finish(db,job,'canceled','ACCESS_REVOKED_OR_CANCELED');
        if(invalid)return this.finish(db,job,'rejected',code);
        await db.query("UPDATE app.jobs SET status='retrying',error_code=$2,updated_at=now() WHERE id=$1",[job.id,code]);return 'retrying';
      });
      if(status==='retrying')throw new Error(code);return status;
    }
  }
  fail(scope:JobScope){return this.transaction(scope,async(db,job)=>{if(job.kind!=='asset.validate')throw new Error('JOB_KIND_DENIED');return terminal.has(job.status)?job.status:this.finish(db,job,'failed','VALIDATION_RETRIES_EXHAUSTED');});}
}
export class JobDispatcher {
  constructor(readonly pool:Pool,readonly client:Client,readonly taskQueue:string,readonly provisionTaskQueue?:string){}
  async runOnce(){
    const lease=randomUUID();
    const {rows:[row]}=await this.pool.query(`UPDATE app.job_dispatch SET lease_id=$1,leased_until=now()+interval '30 seconds',attempts=attempts+1
      WHERE job_id=(SELECT job_id FROM app.job_dispatch WHERE dispatched_at IS NULL AND available_at<=now() AND (leased_until IS NULL OR leased_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING job_id,organization_id,brand_id,kind`,[lease]);
    if(!row)return false;
    try{
      try{if(!['asset.validate','document.extract','website.extract','brand.analyze','creative.generate','plan.generate','creative.export','creative.video','social.sync','social.authorize','social.connect','social.provision','social.publish','social.reconcile'].includes(row.kind))throw new Error('JOB_KIND_DENIED');if(row.kind==='social.provision'&&!this.provisionTaskQueue)throw new Error('PROVISIONING_QUEUE_UNAVAILABLE');await this.client.workflow.start(row.kind==='social.publish'?'publishSocialWorkflow':row.kind==='social.reconcile'?'reconcileSocialWorkflow':row.kind==='social.provision'?'provisionSocialWorkflow':['social.authorize','social.connect'].includes(row.kind)?'authorizeSocialWorkflow':row.kind==='social.sync'?'syncSocialWorkflow':row.kind==='creative.video'?'generateVideoWorkflow':row.kind==='creative.export'?'exportCreativeWorkflow':row.kind==='plan.generate'?'generatePlanWorkflow':row.kind==='creative.generate'?'generateCreativeWorkflow':row.kind==='document.extract'?'extractDocumentWorkflow':row.kind==='asset.validate'?'validateAssetWorkflow':'processIntakeWorkflow',{workflowId:`desvio-${row.kind==='social.publish'?'publish':row.kind==='social.reconcile'?'reconcile':row.kind==='social.provision'?'social-provision':['social.authorize','social.connect'].includes(row.kind)?'social-oauth':row.kind==='social.sync'?'social-sync':row.kind==='creative.video'?'video':row.kind==='creative.export'?'export':row.kind==='plan.generate'?'plan':row.kind==='creative.generate'?'creative':row.kind==='document.extract'?'document':row.kind==='asset.validate'?'asset':'intake'}-${row.job_id}`,workflowIdReusePolicy:WorkflowIdReusePolicy.REJECT_DUPLICATE,
        taskQueue:row.kind==='social.provision'?this.provisionTaskQueue!:this.taskQueue,args:[{organizationId:row.organization_id,brandId:row.brand_id,jobId:row.job_id}]});}
      catch(error){if(!(error instanceof WorkflowExecutionAlreadyStartedError))throw error;}
      await this.pool.query('UPDATE app.job_dispatch SET dispatched_at=now(),leased_until=NULL,last_error=NULL WHERE job_id=$1 AND lease_id=$2',[row.job_id,lease]);
    }catch{await this.pool.query("UPDATE app.job_dispatch SET last_error='WORKFLOW_SERVICE_UNAVAILABLE' WHERE job_id=$1 AND lease_id=$2",[row.job_id,lease]);}
    return true;
  }
}
