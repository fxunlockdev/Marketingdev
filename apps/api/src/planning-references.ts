import {referenceColumns,referenceJoins} from './brand-references.js';
import {CreativeError} from './creative-contracts.js';
export type PlanningReference={id:string;label:string;sha256:string;kind:string;width:number;height:number};
export async function planningReferences(db:any,org:string,brand:string):Promise<PlanningReference[]>{
 const rows=(await db.query(`SELECT ${referenceColumns} FROM app.brand_references r ${referenceJoins}
  WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.revoked_at IS NULL ORDER BY r.approved_at,r.id LIMIT 30`,[org,brand])).rows;
 return rows.map((r:any)=>({id:r.id,label:r.label,sha256:r.sha256,kind:r.kind,width:r.width,height:r.height}));
}
export async function assertPlanningReferences(db:any,org:string,brand:string,references:PlanningReference[]=[]){
 if(!references.length)return;
 const current=await planningReferences(db,org,brand);
 if(references.some(r=>!current.some(c=>c.id===r.id&&c.sha256===r.sha256)))throw new CreativeError('PLAN_REFERENCE_CHANGED');
}
