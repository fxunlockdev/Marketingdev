import {CreativeError} from './creative-contracts.js';
import {INSIGHT_SKILLS} from './insight-skill-pins.js';
export type InsightInput={task:'performance_analysis';brand:{id:string;sha256:string;facts:{id:string;field:string;value:string}[]};observations:any[]};
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const text=(v:any,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export function validateInsights(value:any,input:InsightInput){
 const fail=():never=>{throw new CreativeError('INSIGHT_OUTPUT_INVALID');};
 if(!exact(value,['insights','limitations'])||!Array.isArray(value.insights)||value.insights.length<1||value.insights.length>5||!Array.isArray(value.limitations)||!value.limitations.length||value.limitations.length>10||value.limitations.some((s:any)=>!text(s,500)))fail();
 for(const insight of value.insights){
  if(!exact(insight,['title','summary','hypothesis','next_test','evidence_ids','limitations'])||!text(insight.title,140)||!text(insight.summary,1500)||!text(insight.hypothesis,1000)||!text(insight.next_test,1500)||!Array.isArray(insight.limitations)||!insight.limitations.length||insight.limitations.length>10||insight.limitations.some((s:any)=>!text(s,500))||!Array.isArray(insight.evidence_ids)||!insight.evidence_ids.length||insight.evidence_ids.length>20||new Set(insight.evidence_ids).size!==insight.evidence_ids.length||insight.evidence_ids.some((id:any)=>!input.observations.some(o=>o.id===id)))fail();
 }
 return value;
}
export function validateInsightResult(value:any,input:InsightInput){
 const fail=():never=>{throw new CreativeError('SKILL_OUTPUT_INVALID');};
 if(!exact(value,['type','version','analysis','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!=='deepagents-0.7.29/desvio-insight-v1'||value.helpers_executed!==false||!Number.isInteger(value.model_calls)||value.model_calls<1||value.model_calls>3||!Array.isArray(value.skills)||value.skills.map((s:any)=>s?.name).sort().join(',')!==Object.keys(INSIGHT_SKILLS).sort().join(',')||!Array.isArray(value.reads)||value.reads.length>50)fail();
 for(const s of value.skills){const pin=INSIGHT_SKILLS[s.name as keyof typeof INSIGHT_SKILLS];if(!pin||s.skill_sha256!==pin.skill_sha256||s.tree_sha256!==pin.tree_sha256||!value.reads.includes(`/skills/${s.name}/SKILL.md`))fail();}
 if(value.reads.some((p:any)=>typeof p!=='string'||p.includes('..')||(p!=='/.agents/product-marketing.md'&&!Object.keys(INSIGHT_SKILLS).some(s=>p.startsWith(`/skills/${s}/`)))))fail();
 validateInsights(value.analysis,input);return value;
}
