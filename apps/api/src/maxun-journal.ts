import {AssetJobs,type JobScope} from './jobs.js';
import {type MaxunJournal,type MaxunCheckpoint} from './maxun-workflow.js';
import {IntakeError} from './safe-web.js';
/** AssetJobs.transaction locks the exact job and sets tenant/brand/job RLS context. */
export function maxunJournal(jobs:AssetJobs,scope:JobScope):MaxunJournal {
 const transaction=<T>(action:(db:any,j:any)=>Promise<T>)=>jobs.transaction(scope,async(db,j)=>{
  if(j.kind!=='website.extract')throw new IntakeError('JOB_KIND_DENIED');
  return action(db,j);
 });
 return {
  permitted:()=>transaction((db,j)=>jobs.permitted(db,j)),
  load:()=>transaction(async(db,j)=>{
   if(!await jobs.permitted(db,j))throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
   let saved=(await db.query('SELECT checkpoint FROM app.website_capture_calls WHERE job_id=$1',[j.id])).rows[0]?.checkpoint;
   if(!saved){
    const recovery=(await db.query('SELECT source_job_id FROM app.intake_recoveries WHERE job_id=$1',[j.id])).rows[0];
    if(recovery){
     const source=(await db.query('SELECT checkpoint FROM app.website_capture_calls WHERE job_id=$1',[recovery.source_job_id])).rows[0];
     if(!source)throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
     if(!['submitting','polling'].includes(source.checkpoint.phase))throw new IntakeError('MAXUN_SUBMISSION_UNKNOWN');
     saved={...source.checkpoint,recoveryOnly:true};
     await db.query('INSERT INTO app.website_capture_calls(job_id,organization_id,brand_id,checkpoint) VALUES($1,$2,$3,$4)',[j.id,j.organization_id,j.brand_id,JSON.stringify(saved)]);
    }
   }
   return saved??null;
  }),
  replace:(expected:MaxunCheckpoint|null,next:MaxunCheckpoint)=>transaction(async(db,j)=>{
   if(!await jobs.permitted(db,j))throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
   if(['succeeded','failed','rejected','canceled','unknown'].includes(j.status))return false;
   const result=expected===null
    ?await db.query('INSERT INTO app.website_capture_calls(job_id,organization_id,brand_id,checkpoint) VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO NOTHING',[j.id,j.organization_id,j.brand_id,JSON.stringify(next)])
    :await db.query('UPDATE app.website_capture_calls SET checkpoint=$3,updated_at=now() WHERE job_id=$1 AND checkpoint=$2::jsonb',[j.id,JSON.stringify(expected),JSON.stringify(next)]);
   return result.rowCount===1;
  }),
 };
}
