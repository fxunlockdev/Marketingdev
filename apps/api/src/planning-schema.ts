import type {ContentMixItem} from './generation-plan.js';
// Only what the schema reads. Kept structural so the web app can import this file
// without pulling the server-side planning contracts into its type check.
type PlanningInput={content_mix?:ContentMixItem[];preferences:{channels:string[]};references?:{id:string}[];planning_mode?:'natural';post_count:number;brand:{facts:{id:string}[]};storylines?:true};
import {campaignMonthDays} from './generation-plan.js';
import {addDays,dayStart} from './local-calendar.js';
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
  ...(input.storylines?{storyline:storylineSchema(storylineKind(row.format,row.spec),row.spec?.slide_count??undefined)}:{}),
  ...(row.format==='video'?{video_draft:object({storyline:text(600),script:text(1200),prompt:text(1200),duration_seconds:{type:'integer',minimum:3,maximum:15}})}:{}),
 }));
 return {...object({title:text(140),strategy:text(4000),warnings:array(text(500),0,10),slots:array({anyOf:slots},input.planning_mode==='natural'?1:input.post_count,input.planning_mode==='natural'?90:input.post_count),
 ...(input.planning_mode==='natural'?{settings:object({duration_days:{type:'integer',minimum:1,maximum:90},post_count:{type:'integer',minimum:1,maximum:90},video_count:{type:'integer',minimum:0,maximum:30}})}:{})}),
 $defs:{factId:{type:'string',enum:input.brand.facts.map(f=>f.id)}}};
}

export type PlanDuration='week'|'month'|number;
export type PlanHorizon={starts_on:string;ends_on:string;duration_days:number;start:string;end:string};
/** A week, a rolling calendar month or a custom day count as one exact local-date range.
 * `ends_on` is the last local day; `start`/`end` are the instants of that range in the
 * business's time zone, `end` exclusive, so daylight-saving days keep their real length. */
export function planHorizon(duration:PlanDuration,startsOn:string,timezone:string):PlanHorizon{
 const fail=():never=>{throw new Error('PLAN_HORIZON_INVALID');};
 try{
  if(typeof startsOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)||addDays(startsOn,0)!==startsOn)return fail();
  const days=duration==='week'?7:duration==='month'?campaignMonthDays(startsOn):duration;
  if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>90)return fail();
  return {starts_on:startsOn,ends_on:addDays(startsOn,days-1),duration_days:days,start:dayStart(startsOn,timezone),end:dayStart(addDays(startsOn,days),timezone)};
 }catch{return fail();}
}

/** Layouts a single image can be built on. The image engine uses the same six names. */
export const LAYOUT_ARCHETYPES=['lifestyle_hero','product_hero','type_led_poster','comparison','offer','quote'] as const;
export const SLIDE_ROLES=['hook','context','point','proof','cta'] as const;
export type StaticStoryline={kind:'static';concept:string;hook:string;layout_archetype:typeof LAYOUT_ARCHETYPES[number];art_direction:string;on_image_copy:{headline:string;supporting:string;cta:string}};
export type CarouselStoryline={kind:'carousel';concept:string;slides:{role:typeof SLIDE_ROLES[number];message:string}[]};
export type StoryStoryline={kind:'story';concept:string;frames:{visual:string;text:string}[]};
export type VideoStoryline={kind:'video';concept:string;shots:{visual:string;camera:string;on_screen_text:string}[]};
/** What the customer reads and edits for a slot before anything is generated. */
export type Storyline=StaticStoryline|CarouselStoryline|StoryStoryline|VideoStoryline;
const LIMITS={concept:300,hook:160,art_direction:400,headline:80,supporting:140,cta:40,message:160,visual:200,text:100,camera:100} as const;
/** A full-screen image is a story; a feed image is static; video keeps its draft and gains shots. */
export function storylineKind(format:string,spec?:{placement?:string}|null):Storyline['kind']{
 return format==='video'?'video':format==='carousel'?'carousel':spec?.placement==='story'?'story':'static';
}
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const words=(value:unknown,max:number,empty=false)=>typeof value==='string'&&(empty||value.trim().length>0)&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const list=(value:unknown,min:number,max:number):value is unknown[]=>Array.isArray(value)&&value.length>=min&&value.length<=max;
/** Strict check of a generated or customer-edited storyline against its slot. Throws STORYLINE_INVALID. */
export function validateStoryline(value:unknown,format:string,spec?:{placement?:string;slide_count?:number|null}|null):Storyline{
 const kind=storylineKind(format,spec),v=value as any;
 const ok=kind==='static'?exact(v,['kind','concept','hook','layout_archetype','art_direction','on_image_copy'])&&words(v.hook,LIMITS.hook)&&(LAYOUT_ARCHETYPES as readonly unknown[]).includes(v.layout_archetype)&&words(v.art_direction,LIMITS.art_direction)&&exact(v.on_image_copy,['headline','supporting','cta'])&&words(v.on_image_copy.headline,LIMITS.headline)&&words(v.on_image_copy.supporting,LIMITS.supporting,true)&&words(v.on_image_copy.cta,LIMITS.cta,true)
  :kind==='carousel'?exact(v,['kind','concept','slides'])&&list(v.slides,spec?.slide_count??2,spec?.slide_count??10)&&v.slides.every((s:any)=>exact(s,['role','message'])&&(SLIDE_ROLES as readonly unknown[]).includes(s.role)&&words(s.message,LIMITS.message))
  :kind==='story'?exact(v,['kind','concept','frames'])&&list(v.frames,1,4)&&v.frames.every((f:any)=>exact(f,['visual','text'])&&words(f.visual,LIMITS.visual)&&words(f.text,LIMITS.text,true))
  :exact(v,['kind','concept','shots'])&&list(v.shots,2,6)&&v.shots.every((s:any)=>exact(s,['visual','camera','on_screen_text'])&&words(s.visual,LIMITS.visual)&&words(s.camera,LIMITS.camera)&&words(s.on_screen_text,LIMITS.text,true));
 if(!ok||v.kind!==kind||!words(v.concept,LIMITS.concept))throw new Error('STORYLINE_INVALID');
 return v as Storyline;
}
const optional=(maxLength:number)=>({type:'string',maxLength});
/** Provider-side shape of one storyline. Semantic checks stay in validateStoryline. */
export function storylineSchema(kind:Storyline['kind'],slideCount?:number):Record<string,unknown>{
 const head={kind:{type:'string',enum:[kind]},concept:text(LIMITS.concept)};
 if(kind==='static')return object({...head,hook:text(LIMITS.hook),layout_archetype:{type:'string',enum:[...LAYOUT_ARCHETYPES]},art_direction:text(LIMITS.art_direction),on_image_copy:object({headline:text(LIMITS.headline),supporting:optional(LIMITS.supporting),cta:optional(LIMITS.cta)})});
 if(kind==='carousel')return object({...head,slides:array(object({role:{type:'string',enum:[...SLIDE_ROLES]},message:text(LIMITS.message)}),slideCount??2,slideCount??10)});
 if(kind==='story')return object({...head,frames:array(object({visual:text(LIMITS.visual),text:optional(LIMITS.text)}),1,4)});
 return object({...head,shots:array(object({visual:text(LIMITS.visual),camera:text(LIMITS.camera),on_screen_text:optional(LIMITS.text)}),2,6)});
}
