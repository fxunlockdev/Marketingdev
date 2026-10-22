import {BadRequestException, ConflictException, NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {object,uuid} from './workspaces.js';
import {canonicalJSON,hash,lockReview,bumpReview} from './brand-brain.js';

// Evidence stays immutable; only the human's direction/decision can change.
export async function visualDirections(db:PoolClient,org:string,brand:string){
 const analysis=(await db.query(`SELECT j.id,j.created_at,r.result FROM app.jobs j JOIN app.intake_requests r ON r.job_id=j.id
 WHERE j.organization_id=$1 AND j.brand_id=$2 AND j.kind='brand.analyze' AND j.status='succeeded'
 ORDER BY j.created_at DESC,j.id DESC LIMIT 1`,[org,brand])).rows[0];
 if(!analysis)return {analysis_job_id:null,stale:false,directions:[],retained:[],retained_directions:[]};
 const newer=(await db.query(`SELECT 1 FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='website.extract' AND status='succeeded' AND created_at>$3 LIMIT 1`,[org,brand,analysis.created_at])).rowCount;
 const reviews=(await db.query('SELECT * FROM app.brand_visual_reviews WHERE organization_id=$1 AND brand_id=$2 AND analysis_job_id=$3',[org,brand,analysis.id])).rows;
 const manifest=analysis.result?.visual_manifest??[];
 const directions=(analysis.result?.visual_guidance??[]).map((suggestion:any,index:number)=>{
  const review=reviews.find((r:any)=>r.suggestion_index===index);
  const unchanged=review&&canonicalJSON(review.suggestion)===canonicalJSON(suggestion)&&canonicalJSON(review.manifest)===canonicalJSON(manifest);
  return {analysis_job_id:analysis.id,index,suggestion,manifest,evidence_sha256:hash(canonicalJSON({suggestion,manifest})),
   review:unchanged?{id:review.id,status:review.status,value:review.value,revision:review.revision,reviewed_by:review.reviewed_by,reviewed_at:review.reviewed_at}:null};
 });
 const prior=(await db.query('SELECT snapshot FROM app.brand_brain_versions WHERE organization_id=$1 AND brand_id=$2 ORDER BY review_revision DESC LIMIT 1',[org,brand])).rows[0];
 const addressed=new Set(directions.map((d:any)=>`visual_direction_${d.suggestion.category}`));
 const retained=(prior?.snapshot.facts??[]).filter((f:any)=>f.evidence_type==='approved_visual_direction'&&!addressed.has(f.field));
 const retainedDirections=[];
 const retainedRows=retained.length?(await db.query('SELECT * FROM app.brand_visual_reviews WHERE organization_id=$1 AND brand_id=$2 AND id=ANY($3::uuid[])',[org,brand,retained.map((f:any)=>f.id)])).rows:[];
 for(const fact of retained){
  const row=retainedRows.find((r:any)=>r.id===fact.id);
  if(!row||hash(canonicalJSON({suggestion:row.suggestion,manifest:row.manifest}))!==fact.evidence_sha256||row.analysis_job_id!==fact.analysis_job_id||row.suggestion_index!==fact.suggestion_index||`visual_direction_${row.suggestion.category}`!==fact.field)
   throw new ConflictException('Approved visual evidence could not be verified');
  retainedDirections.push({analysis_job_id:row.analysis_job_id,index:row.suggestion_index,suggestion:row.suggestion,manifest:row.manifest,
   evidence_sha256:fact.evidence_sha256,retained:true,approved_value:fact.value,
   review:{id:row.id,status:row.status,value:row.value,revision:row.revision,reviewed_by:row.reviewed_by,reviewed_at:row.reviewed_at}});
 }
 return {analysis_job_id:analysis.id,stale:!!newer,directions,retained,retained_directions:retainedDirections};
}
export async function reviewVisual(db:PoolClient,user:string,org:string,brand:string,input:unknown){
 const b=object(input,['analysis_job_id','index','evidence_sha256','revision','decision','value']);
 const job=uuid(String(b.analysis_job_id));
 if(!Number.isInteger(b.index)||Number(b.index)<0||Number(b.index)>11||!Number.isSafeInteger(b.revision)||Number(b.revision)<0||
 !['correct','wrong','edited'].includes(String(b.decision))||typeof b.evidence_sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.evidence_sha256))throw new BadRequestException('A current visual suggestion and review decision are required');
 if(b.decision!=='edited'&&b.value!==undefined)throw new BadRequestException('Only Edit accepts a replacement direction');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${org}`]);
 if(!(await db.query('SELECT app.can_access($1,true) AND app.business_access($1,$2,true) AS allowed',[org,brand])).rows[0].allowed)throw new NotFoundException('Business not found');
 await lockReview(db,org,brand);
 const current=await visualDirections(db,org,brand),d=[...current.directions,...current.retained_directions].find((d:any)=>d.index===b.index&&d.analysis_job_id===job);
 if(!d)throw new NotFoundException('Visual suggestion not found');
 if((current.stale&&!d.retained)||d.evidence_sha256!==b.evidence_sha256)throw new ConflictException('Visual evidence changed. Run analysis again and review the latest suggestions.');
 const value=b.decision==='edited'?b.value:d.suggestion.creative_direction;
 if(typeof value!=='string'||!value.trim()||value.length>1500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new BadRequestException('Use 1–1500 characters of plain text');
 // Exact retry after a lost response is a no-op; changed stale writes conflict.
 if(d.review&&d.review.revision===Number(b.revision)+1&&d.review.status===b.decision&&d.review.value===value.trim())return d.review;
 if((d.review?.revision??0)!==b.revision)throw new ConflictException('This visual decision changed. Reload before saving.');
 let result;
 if(d.review)result=(await db.query(`UPDATE app.brand_visual_reviews SET status=$4,value=$5,revision=revision+1,reviewed_by=$6,reviewed_at=now()
 WHERE organization_id=$1 AND brand_id=$2 AND id=$3 RETURNING id,status,value,revision,reviewed_by,reviewed_at`,[org,brand,d.review.id,b.decision,value.trim(),user])).rows[0];
 else result=(await db.query(`INSERT INTO app.brand_visual_reviews(id,organization_id,brand_id,analysis_job_id,suggestion_index,suggestion,manifest,status,value,reviewed_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status,value,revision,reviewed_by,reviewed_at`,[randomUUID(),org,brand,job,b.index,JSON.stringify(d.suggestion),JSON.stringify(d.manifest),b.decision,value.trim(),user])).rows[0];
 await bumpReview(db,org,brand);
 return result;
}
export async function approvedVisualFacts(db:PoolClient,org:string,brand:string){
 const current=await visualDirections(db,org,brand);
 if(current.directions.length&&current.stale)throw new ConflictException('Website evidence changed. Analyze and review the updated visual style before approving.');
 if(current.directions.some((d:any)=>!d.review))throw new ConflictException('Review every visual direction or mark it Wrong before approving');
 return [...current.retained_directions,...current.directions].filter((d:any)=>d.review.status!=='wrong').map((d:any)=>({
  id:d.review.id,field:`visual_direction_${d.suggestion.category}`,value:d.review.value,status:d.review.status,
  evidence_type:'approved_visual_direction',analysis_job_id:d.analysis_job_id,suggestion_index:d.index,
  evidence_sha256:d.evidence_sha256,observation:d.suggestion.observation,
  references:d.manifest.filter((r:any)=>d.suggestion.image_ids.includes(r.id)),
  reviewed_by:d.review.reviewed_by,reviewed_at:d.review.reviewed_at,
 }));
}
