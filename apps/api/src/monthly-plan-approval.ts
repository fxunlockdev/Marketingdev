import {ConflictException} from '@nestjs/common';
import type {PoolClient} from 'pg';

// Independent Canvas creations have no guided plan. Existing posts can be revised
// after production starts without asking users to approve their whole month again.
export async function requireMonthlyPlanApproval(db:PoolClient, organization:string, brand:string, slot:{id:string;plan_id:string;revision:number}) {
 const plan=(await db.query(`SELECT g.plan_approved_at,g.generation_started_at,g.approved_slots
  FROM app.guided_campaigns g JOIN app.planning_requests r ON r.job_id=g.planning_job_id
  WHERE g.organization_id=$1 AND g.brand_id=$2 AND r.output_plan_id=$3`,[organization,brand,slot.plan_id])).rows[0];
 if(!plan||plan.generation_started_at)return;
 if(!plan.plan_approved_at||!plan.approved_slots?.some((s:{id:string;revision:number})=>s.id===slot.id&&s.revision===slot.revision))
  throw new ConflictException('Approve the latest topics and dates in Calendar before creating these assets.');
}
