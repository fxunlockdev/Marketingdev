import { CreativeError, type CreativeInput, type SkillResult } from './creative-contracts.js';
import { CREATIVE_SKILLS } from './creative-skill-pins.js';
import { planTime } from './content-plan.js';
export const PLANNING_SKILLS = {
 'marketing-plan':{skill_sha256:'2b75dfae852bdb61fd96eebe3d2b373f99f67c86ff830f796310f662ba8906e8',tree_sha256:'d3f0c84f21bf77fb851403e95bd1d0270d81ae664d61a39cd003764fe5571fd6'},
 'product-marketing':CREATIVE_SKILLS['product-marketing'], social:CREATIVE_SKILLS.social,
};
export type PlanningInput={task:'content_plan';brand:CreativeInput['brand'];preferences:{starts_on:string;timezone:string;goal:string;cadence:number;channels:('linkedin'|'instagram')[];must_avoid:string;revision:number};brief:string;post_count:number;duration_days?:number};
export type GeneratedPlan={title:string;strategy:string;warnings:string[];slots:{channel:'linkedin'|'instagram';planned_at:string;format:'static';brief:string;pillar:string;hook:string;cta:string;fact_ids:string[]}[]};
export type PlanningResult=Omit<SkillResult,'brief'> & {plan:GeneratedPlan};
function fields(value:any,keys:string[]) {return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');}
function plain(v:any,max:number,empty=false) {return typeof v==='string'&&(empty||v.trim().length>0)&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);}
export function validateGeneratedPlan(value:any,input:PlanningInput):GeneratedPlan {
 const fail=()=>{throw new CreativeError('PLAN_OUTPUT_INVALID');};
 const days=input.duration_days??30;
 if(!Number.isInteger(days)||days<1||days>90||!Number.isInteger(input.post_count)||input.post_count<1||input.post_count>90)fail();
 if(!fields(value,['title','strategy','warnings','slots'])||!plain(value.title,140)||!plain(value.strategy,4000)||!Array.isArray(value.warnings)||value.warnings.length>10||value.warnings.some((v:any)=>!plain(v,500))||!Array.isArray(value.slots)||value.slots.length!==input.post_count)fail();
 if(Buffer.byteLength(JSON.stringify(value))>100000)fail();
 const seen=new Set(),channels=new Set(),weeks=new Set();
 for(const s of value.slots){
  if(!fields(s,['channel','planned_at','format','brief','pillar','hook','cta','fact_ids'])||!input.preferences.channels.includes(s.channel)||s.format!=='static'||!plain(s.brief,1000)||!plain(s.pillar,140)||!plain(s.hook,200)||!plain(s.cta,120)||!Array.isArray(s.fact_ids)||!s.fact_ids.length||s.fact_ids.length>10||new Set(s.fact_ids).size!==s.fact_ids.length||s.fact_ids.some((id:any)=>!input.brand.facts.some(f=>f.id===id)))fail();
  try{
   planTime(s.planned_at,input.preferences.starts_on,input.preferences.timezone,days);
   const parts=new Intl.DateTimeFormat('en',{timeZone:input.preferences.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(s.planned_at));
   const part=(type:string)=>parts.find(p=>p.type===type)!.value;
   const local=`${part('year')}-${part('month')}-${part('day')}`;
   weeks.add(Math.min(Math.ceil(days/7)-1,Math.floor((Date.parse(local)-Date.parse(input.preferences.starts_on))/86400000/7)));
  }catch{fail();}
  const signature=[s.brief,s.hook].map((v:string)=>v.trim().toLowerCase().replace(/\s+/g,' ')).join('|');
  if(seen.has(signature))fail();
  seen.add(signature);channels.add(s.channel);
 }
 if(channels.size!==Math.min(input.post_count,input.preferences.channels.length)||weeks.size!==Math.min(input.post_count,Math.ceil(days/7)))fail();
 return value;
}
export function validatePlanningResult(value:any,input:PlanningInput):PlanningResult {
 if(!fields(value,['type','version','plan','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!=='deepagents-0.7.29/desvio-plan-v1'||value.helpers_executed!==false||!Number.isInteger(value.model_calls)||value.model_calls<1||value.model_calls>3||!Array.isArray(value.skills)||value.skills.map((s:any)=>s?.name).sort().join(',')!==Object.keys(PLANNING_SKILLS).sort().join(',')||!Array.isArray(value.reads)||value.reads.length>50)throw new CreativeError('SKILL_OUTPUT_INVALID');
 for(const s of value.skills){
  const pin=PLANNING_SKILLS[s.name as keyof typeof PLANNING_SKILLS];
  if(!pin||s.skill_sha256!==pin.skill_sha256||s.tree_sha256!==pin.tree_sha256||!value.reads.includes(`/skills/${s.name}/SKILL.md`))throw new CreativeError('SKILL_DIGEST_MISMATCH');
 }
 if(value.reads.some((p:any)=>typeof p!=='string'||p.includes('..')||(p!=='/.agents/product-marketing.md'&&!Object.keys(PLANNING_SKILLS).some(s=>p.startsWith(`/skills/${s}/`)))))throw new CreativeError('SKILL_PATH_DENIED');
 validateGeneratedPlan(value.plan,input);return value;
}
