import {CreativeError} from './creative-contracts.js';
import {canonicalJSON} from './brand-brain.js';
export type LearningContext={id:string;revision:number;kind:'unproven_hypothesis';hypothesis:string;next_test:string;applicability:string}[];
function snapshot(row:any):LearningContext[number]{return {id:row.id,revision:row.revision,kind:'unproven_hypothesis',hypothesis:row.content.hypothesis,next_test:row.content.next_test,applicability:row.applicability};}
export function validLearning(value:any):value is LearningContext{return Array.isArray(value)&&value.length<=10&&value.every(r=>r&&typeof r==='object'&&Object.keys(r).sort().join(',')==='applicability,hypothesis,id,kind,next_test,revision'&&typeof r.id==='string'&&/^[a-f0-9-]{36}$/i.test(r.id)&&Number.isInteger(r.revision)&&r.revision>0&&r.kind==='unproven_hypothesis'&&typeof r.hypothesis==='string'&&r.hypothesis.length<=1000&&typeof r.next_test==='string'&&r.next_test.length<=1500&&typeof r.applicability==='string'&&r.applicability.length<=1000)&&new Set(value.map(r=>r.id)).size===value.length;}
export async function approvedLearning(db:any):Promise<LearningContext>{return (await db.query("SELECT id,revision,content,applicability FROM app.memory_lessons WHERE state='testing' ORDER BY reviewed_at DESC,id LIMIT 10")).rows.map(snapshot);}
export async function assertLearningCurrent(db:any,value:any){
 const context=value??[];if(!validLearning(context))throw new CreativeError('MEMORY_CONTEXT_INVALID');if(!context.length)return;
 const rows=(await db.query("SELECT id,revision,content,applicability FROM app.memory_lessons WHERE id=ANY($1::uuid[]) AND state='testing'",[context.map(r=>r.id)])).rows;
 if(rows.length!==context.length||context.some(r=>{const row=rows.find((x:any)=>x.id===r.id);return !row||canonicalJSON(snapshot(row))!==canonicalJSON(r);}))throw new CreativeError('MEMORY_CONTEXT_CHANGED');
}
