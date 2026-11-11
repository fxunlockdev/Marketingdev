import type {PlanningInput} from './planning-contracts.js';
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const array=(items:unknown,minItems:number,maxItems:number)=>({type:'array',items,minItems,maxItems});
// Preserve owner-selected formats and typography, regardless of JSON key ordering.
function literal(value:any):any {
 if(value===null)return {type:'null'};
 if(typeof value==='object')return object(Object.fromEntries(Object.entries(value).map(([key,v])=>[key,literal(v)])));
 return {type:typeof value==='number'?'integer':typeof value,enum:[value]};
}
export function planningSchema(input:PlanningInput):Record<string,unknown>{
 const variants=input.content_mix?.map(row=>({channel:row.channel,format:row.format,spec:row.creative_spec}))??input.preferences.channels.flatMap(channel=>['static','video'].map(format=>({channel,format,spec:undefined})));
 const slots=variants.map(row=>object({
  channel:{type:'string',enum:[row.channel]},planned_at:text(40),format:{type:'string',enum:[row.format]},
  ...(row.spec?{creative_spec:literal(row.spec)}:{}),brief:text(1000),pillar:text(140),hook:text(200),cta:text(120),
  fact_ids:array({$ref:'#/$defs/factId'},1,10),
  ...(input.references?.length?{reference_ids:array({type:'string',enum:input.references.map(r=>r.id)},0,row.format==='video'?0:3)}:{}),
  ...(row.format==='video'?{video_draft:object({storyline:text(600),script:text(1200),prompt:text(1200),duration_seconds:{type:'integer',minimum:3,maximum:15}})}:{}),
 }));
 return {...object({title:text(140),strategy:text(4000),warnings:array(text(500),0,10),slots:array({anyOf:slots},input.planning_mode==='natural'?1:input.post_count,input.planning_mode==='natural'?90:input.post_count),
 ...(input.planning_mode==='natural'?{settings:object({duration_days:{type:'integer',minimum:1,maximum:90},post_count:{type:'integer',minimum:1,maximum:90},video_count:{type:'integer',minimum:0,maximum:30}})}:{})}),
 $defs:{factId:{type:'string',enum:input.brand.facts.map(f=>f.id)}}};
}
