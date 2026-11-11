import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireMonthlyPlanApproval} from '../../dist/monthly-plan-approval.js';
const slot={id:'post',plan_id:'plan',revision:3};
const db=plan=>({query:async(sql,args)=>{assert.deepEqual(args,['org','brand','plan']);assert.match(sql,/g.organization_id=\$1 AND g.brand_id=\$2/);return {rows:plan?[plan]:[]};}});
test('monthly assets require approval of the exact post revision',async()=>{
 await assert.rejects(requireMonthlyPlanApproval(db({plan_approved_at:null}), 'org','brand',slot),/Approve the latest/);
 await assert.rejects(requireMonthlyPlanApproval(db({plan_approved_at:'today',approved_slots:[{id:'post',revision:2}]}),'org','brand',slot),/Approve the latest/);
 await requireMonthlyPlanApproval(db({plan_approved_at:'today',approved_slots:[{id:'post',revision:3}]}),'org','brand',slot);
});
test('custom posts and later revisions do not require approving the whole calendar again',async()=>{
 await requireMonthlyPlanApproval(db(null),'org','brand',slot);
 await requireMonthlyPlanApproval(db({generation_started_at:'today'}),'org','brand',slot);
});
