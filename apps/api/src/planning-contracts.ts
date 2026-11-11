import {validStoredSkillSet} from './production-skill-pin.js';
import {PRODUCTION_SKILL} from "./production-skill-pin.js";
import {normalizeCreativeSpec,type CreativeSpec} from './campaign-formats.js';
import {normalizeContentMix,contentMixCounts,type ContentMixItem} from './generation-plan.js';
import type {PlanningReference} from './planning-references.js';
import type {CampaignInput} from './campaign-input.js';
import {validateVideoConcept,type VideoConcept} from './video-concept.js';
import { CreativeError, type CreativeInput, type SkillResult } from './creative-contracts.js';
import { CREATIVE_SKILLS } from './creative-skill-pins.js';
import {addDays,dayStart,localCandidates,localMinute} from './local-calendar.js';
import { planTime } from './content-plan.js';
export const PLANNING_SKILLS = {
 "desvio-production": PRODUCTION_SKILL,
 "brand-engine":CREATIVE_SKILLS["brand-engine"],
 'marketing-plan':{skill_sha256:'2b75dfae852bdb61fd96eebe3d2b373f99f67c86ff830f796310f662ba8906e8',tree_sha256:'d3f0c84f21bf77fb851403e95bd1d0270d81ae664d61a39cd003764fe5571fd6'},
 'product-marketing':CREATIVE_SKILLS['product-marketing'], social:CREATIVE_SKILLS.social,
};
export type PostIdeaPurpose={plan_id:string;format:string;channel:string};
export type PlanningInput={post_ideas?:PostIdeaPurpose;content_mix?:ContentMixItem[];max_posts_per_day?:number;references?:PlanningReference[];campaign?:CampaignInput;task:'content_plan';brand:CreativeInput['brand'];preferences:{starts_on:string;timezone:string;goal:string;cadence:number;channels:('linkedin'|'instagram'|'facebook')[];must_avoid:string;business_stage?:string;growth_expectation?:string;creative_brief?:import('./creative-brief.js').CreativeBrief;revision:number};brief:string;post_count:number;duration_days?:number;video_count?:number;planning_mode?:'natural';reference_plan?:{id:string;sha256:string;title:string;duration_days:number;starts_on:string;timezone:string;slots:unknown[]}};
export type GeneratedPlan={settings?:{duration_days:number;post_count:number;video_count:number};title:string;strategy:string;warnings:string[];slots:{channel:'linkedin'|'instagram'|'facebook';planned_at:string;format:'static'|'video'|'carousel';creative_spec?:CreativeSpec;video_draft?:VideoConcept;brief:string;pillar:string;hook:string;cta:string;fact_ids:string[];reference_ids?:string[]}[]};
export type PlanningResult=Omit<SkillResult,'brief'> & {plan:GeneratedPlan};
function fields(value:any,keys:string[]) {return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');}
function plain(v:any,max:number,empty=false) {return typeof v==='string'&&(empty||v.trim().length>0)&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);}
export function resolvedPlanningInput(input:PlanningInput,plan:any):PlanningInput {
 if(input.planning_mode!=='natural')return input;
 const s=plan?.settings;
 if(!fields(s,['duration_days','post_count','video_count'])||!Number.isInteger(s.duration_days)||s.duration_days<1||s.duration_days>90||!Number.isInteger(s.post_count)||s.post_count<1||s.post_count>90||!Number.isInteger(s.video_count)||s.video_count<0||s.video_count>Math.min(s.post_count,30))throw new CreativeError('PLAN_OUTPUT_INVALID');
 return {...input,duration_days:s.duration_days,post_count:s.post_count,video_count:s.video_count};
}
export function validateGeneratedPlan(value:any,input:PlanningInput):GeneratedPlan {
 const fail=()=>{throw new CreativeError('PLAN_OUTPUT_INVALID');};
 const natural=input.planning_mode==='natural';input=resolvedPlanningInput(input,value);
 const days=input.duration_days??30,videos=input.video_count??0;
 if(!Number.isInteger(videos)||videos<0||videos>Math.min(input.post_count,30))fail();
 if(!Number.isInteger(days)||days<1||days>90||!Number.isInteger(input.post_count)||input.post_count<1||input.post_count>90)fail();
 if(!fields(value,['title','strategy','warnings','slots',...(natural?['settings']:[])])||!plain(value.title,140)||!plain(value.strategy,4000)||!Array.isArray(value.warnings)||value.warnings.length>10||value.warnings.some((v:any)=>!plain(v,500))||!Array.isArray(value.slots)||value.slots.length!==input.post_count)fail();
 if(Buffer.byteLength(JSON.stringify(value))>100000)fail();
 let expectedMix:ContentMixItem[]|undefined;try{if(input.content_mix){expectedMix=normalizeContentMix(input.content_mix);const totals=contentMixCounts(expectedMix);if(totals.post_count!==input.post_count||totals.video_count!==videos)fail();}}catch{fail();}
 const actualMix=new Map<string,number>();
 const seen=new Set(),channels=new Set(),weeks=new Set(),daily=new Map<string,number>();
 for(const s of value.slots){
  if(!s||typeof s!=='object'||Array.isArray(s))fail();
  if(!fields(s,['channel','planned_at','format','brief','pillar','hook','cta','fact_ids',...(s.reference_ids!==undefined?['reference_ids']:[]),...(s.format==='video'?['video_draft']:[]),...(expectedMix?['creative_spec']:[])])||!input.preferences.channels.includes(s.channel)||!(expectedMix?['static','video','carousel']:['static','video']).includes(s.format)||!plain(s.brief,1000)||!plain(s.pillar,140)||!plain(s.hook,200)||!plain(s.cta,120)||!Array.isArray(s.fact_ids)||!s.fact_ids.length||s.fact_ids.length>10||new Set(s.fact_ids).size!==s.fact_ids.length||s.fact_ids.some((id:any)=>!input.brand.facts.some(f=>f.id===id)))fail();
  if(s.reference_ids!==undefined&&(!Array.isArray(s.reference_ids)||s.reference_ids.length>3||(s.format==='video'&&s.reference_ids.length>0)||new Set(s.reference_ids).size!==s.reference_ids.length||s.reference_ids.some((id:any)=>!(input.references??[]).some(r=>r.id===id))))fail();
  if(expectedMix){try{const spec=normalizeCreativeSpec(s.creative_spec,s.format,s.channel),key=JSON.stringify([s.channel,s.format,spec]);actualMix.set(key,(actualMix.get(key)??0)+1);}catch{fail();}}
  if(s.format==='video')try{validateVideoConcept(s.video_draft);}catch{fail();}
  try{
   planTime(s.planned_at,input.preferences.starts_on,input.preferences.timezone,days);
   const parts=new Intl.DateTimeFormat('en',{timeZone:input.preferences.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(s.planned_at));
   const part=(type:string)=>parts.find(p=>p.type===type)!.value;
   const local=`${part('year')}-${part('month')}-${part('day')}`;
   daily.set(local,(daily.get(local)??0)+1);if(input.max_posts_per_day!==undefined&&daily.get(local)!>input.max_posts_per_day)fail();
   weeks.add(weekOf(local,input.preferences.starts_on,days));
  }catch{fail();}
  const signature=[s.brief,s.hook].map((v:string)=>v.trim().toLowerCase().replace(/\s+/g,' ')).join('|');
  if(seen.has(signature))fail();
  seen.add(signature);channels.add(s.channel);
 }
 if(expectedMix&&(actualMix.size!==expectedMix.length||expectedMix.some(row=>actualMix.get(JSON.stringify([row.channel,row.format,row.creative_spec]))!==row.count)))fail();
 if(value.slots.filter((s:any)=>s.format==='video').length!==videos)fail();
 if(channels.size!==Math.min(input.post_count,input.preferences.channels.length)||weeks.size!==Math.min(input.post_count,Math.ceil(days/7)))fail();
 return value;
}
export function validatePlanningResult(value:any,input:PlanningInput):PlanningResult {
 if(!fields(value,['type','version','plan','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!=='deepagents-0.7.29/desvio-plan-v1'||value.helpers_executed!==false||!Number.isInteger(value.model_calls)||value.model_calls<1||value.model_calls>3||!validStoredSkillSet(value.skills,Object.keys(PLANNING_SKILLS))||!Array.isArray(value.reads)||value.reads.length>50)throw new CreativeError('SKILL_OUTPUT_INVALID');
 for(const s of value.skills){
  const pin=PLANNING_SKILLS[s.name as keyof typeof PLANNING_SKILLS];
  if(!pin||s.skill_sha256!==pin.skill_sha256||s.tree_sha256!==pin.tree_sha256||!value.reads.includes(`/skills/${s.name}/SKILL.md`))throw new CreativeError('SKILL_DIGEST_MISMATCH');
 }
 if(value.reads.some((p:any)=>typeof p!=='string'||p.includes('..')||(p!=='/.agents/product-marketing.md'&&!Object.keys(PLANNING_SKILLS).some(s=>p.startsWith(`/skills/${s}/`)))))throw new CreativeError('SKILL_PATH_DENIED');
 validateGeneratedPlan(value.plan,input);return value;
}

// Models propose topics; the application owns the bounded draft calendar.
// Campaigns with one static per day keep daily coverage; other plans retain valid dates.
// A plan that leaves a week of its horizon empty is redated, never rejected: the customer
// has already paid for its ideas. All content and provenance checks still run afterwards.
const SAME_DAY_TIMES=['T12:00','T15:00','T09:00','T18:00'] as const;
const CAPPED_DAY_TIMES=['T10:00','T15:00'] as const;
/** First real instant of a local wall-clock minute. A minute skipped by a clock change
 * falls back to the first valid minute of that day rather than leaving a post undated. */
function localInstant(date:string,time:string,timezone:string):string {return localCandidates(date+time,timezone)[0]??dayStart(date,timezone);}
function localDay(instant:string,timezone:string):string {return localMinute(instant,timezone).slice(0,10);}
function weekOf(day:string,startsOn:string,days:number):number {return Math.min(Math.ceil(days/7)-1,Math.floor((Date.parse(day)-Date.parse(startsOn))/86400000/7));}
function coversEveryWeek(slots:any[],startsOn:string,timezone:string,days:number):boolean {
 try{return new Set(slots.map(slot=>weekOf(localDay(slot.planned_at,timezone),startsOn,days))).size===Math.min(slots.length,Math.ceil(days/7));}catch{return false;}
}
/** Ascending day offsets that put a post in every seven-day block of the horizon, a short
 * final block included, whenever there are enough posts. Blocks receive posts in proportion
 * to their length; `perDay` is a hard ceiling. Deterministic for a given count and horizon. */
export function coverageOffsets(count:number,days:number,perDay?:number):number[] {
 const weeks=Math.ceil(days/7),lengths=Array.from({length:weeks},(_,week)=>Math.min(7,days-week*7));
 if(count<weeks)return Array.from({length:count},(_,index)=>Math.floor(index*weeks/count)*7);
 const capacity=lengths.map(length=>perDay===undefined?Number.POSITIVE_INFINITY:length*perDay),share=lengths.map(length=>count*length/days);
 const posts=share.map((value,week)=>Math.max(1,Math.min(capacity[week],Math.floor(value))));
 const pick=(eligible:(week:number)=>boolean,score:(week:number)=>number)=>lengths.reduce((best,_,week)=>eligible(week)&&(best<0||score(week)>score(best))?week:best,-1);
 for(let total=posts.reduce((a,b)=>a+b,0);total!==count;){
  const add=total<count,week=add?pick(w=>posts[w]<capacity[w],w=>share[w]-posts[w]):pick(w=>posts[w]>1,w=>posts[w]-share[w]);
  if(week<0)throw new CreativeError('PLAN_OUTPUT_INVALID');
  posts[week]+=add?1:-1;total+=add?1:-1;
 }
 return posts.flatMap((n,week)=>Array.from({length:n},(_,index)=>week*7+Math.floor(index*lengths[week]/n)));
}
/** Redate every slot, in the model's own order, so each week of the horizon has a post. */
function redistribute(slots:any[],startsOn:string,timezone:string,days:number,perDay?:number):any[] {
 const instants=slots.map(slot=>{try{return Date.parse(planTime(slot?.planned_at,startsOn,timezone,days));}catch{return Number.NaN;}});
 const ordered=instants.some(Number.isNaN)?slots.map((_,index)=>index):slots.map((_,index)=>index).sort((a,b)=>instants[a]-instants[b]||a-b);
 const offsets=coverageOffsets(slots.length,days,perDay),times=perDay===undefined?SAME_DAY_TIMES:CAPPED_DAY_TIMES,used=new Map<number,number>(),placed=new Map<number,string>();
 ordered.forEach((slotIndex,position)=>{
  const offset=offsets[position],nth=used.get(offset)??0;used.set(offset,nth+1);
  placed.set(slotIndex,localInstant(addDays(startsOn,offset),times[nth%times.length],timezone));
 });
 return slots.map((slot,index)=>({...slot,planned_at:placed.get(index)}));
}
const WEEKLY_REPAIR_WARNING='Draft dates were adjusted so every week of your plan has a post. You can change them in the calendar.';
function withWarning(plan:any,warning:string):any {return Array.isArray(plan.warnings)&&plan.warnings.length<10&&!plan.warnings.includes(warning)?{...plan,warnings:[...plan.warnings,warning]}:plan;}
export function scheduleGeneratedPlan(value:any,input:PlanningInput):GeneratedPlan {
 const resolved=resolvedPlanningInput(input,value),days=resolved.duration_days??30,{starts_on,timezone}=resolved.preferences;
 if(!Array.isArray(value?.slots)||value.slots.length!==resolved.post_count||!Number.isInteger(days)||days<1||days>90||value.slots.some((slot:any)=>!slot||typeof slot!=='object'))return validateGeneratedPlan(value,input);
 if(resolved.max_posts_per_day!==undefined){
  if(!Number.isInteger(resolved.max_posts_per_day)||resolved.max_posts_per_day<1||resolved.max_posts_per_day>2||resolved.post_count>days*resolved.max_posts_per_day)throw new CreativeError('PLAN_OUTPUT_INVALID');
  const even=value.slots.map((slot:any,index:number)=>({...slot,planned_at:localInstant(addDays(starts_on,Math.floor(index*days/resolved.post_count)),index%2?'T15:00':'T10:00',timezone)}));
  const slots=coversEveryWeek(even,starts_on,timezone,days)?even:redistribute(value.slots,starts_on,timezone,days,resolved.max_posts_per_day);
  return validateGeneratedPlan({...value,slots},input);
 }
 const invalidDate=value.slots.some((slot:any)=>{try{planTime(slot?.planned_at,starts_on,timezone,days);return false;}catch{return true;}});
 const dailyStatic=Boolean(resolved.campaign)&&resolved.post_count-(resolved.video_count??0)===days&&(!resolved.content_mix||resolved.content_mix.every(row=>row.format==='video'||(row.format==='static'&&row.creative_spec.placement==='feed')));
 const staticDays=new Set(value.slots.filter((slot:any)=>slot?.format==='static').map((slot:any)=>{try{return localDay(slot.planned_at,timezone);}catch{return '';}}));
 const needsDailyPlacement=dailyStatic&&(invalidDate||staticDays.size!==days);
 if(!invalidDate&&!needsDailyPlacement){
  if(coversEveryWeek(value.slots,starts_on,timezone,days))return validateGeneratedPlan(value,input);
  const repaired=withWarning({...value,slots:redistribute(value.slots,starts_on,timezone,days)},WEEKLY_REPAIR_WARNING);
  validateGeneratedPlan(repaired,input);return repaired;
 }
 let staticIndex=0,videoIndex=0;
 const placed=needsDailyPlacement?value.slots.map((slot:any)=>{
  const video=slot?.format==='video';
  const offset=video?Math.floor(videoIndex++*days/Math.max(1,resolved.video_count??0)):staticIndex++;
  return {...slot,planned_at:localInstant(addDays(starts_on,offset),video?'T15:00':'T12:00',timezone)};
 }):value.slots.map((slot:any,index:number)=>({...slot,planned_at:localInstant(addDays(starts_on,value.slots.length===1?0:Math.floor(index*(days-1)/(value.slots.length-1))),'T12:00',timezone)}));
 const slots=coversEveryWeek(placed,starts_on,timezone,days)?placed:redistribute(value.slots,starts_on,timezone,days);
 const repaired=withWarning({...value,slots},needsDailyPlacement?'Image drafts were spread across each day, with video drafts spaced through the campaign. You can change their dates in the calendar.':'Draft dates were adjusted to fit your selected plan duration. You can change them in the calendar.');
 validateGeneratedPlan(repaired,input);
 return repaired;
}
