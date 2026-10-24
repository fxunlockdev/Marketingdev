import {CreativeError,validateBrief,type CreativeBrief,type CreativeInput,type SkillResult} from './creative-contracts.js';
import {CREATIVE_SKILLS} from './creative-skill-pins.js';
import {validLearning} from './learning-context.js';
export const CAROUSEL_SKILLS={
 "brand-engine":CREATIVE_SKILLS["brand-engine"],image:CREATIVE_SKILLS.image,social:CREATIVE_SKILLS.social,'product-marketing':CREATIVE_SKILLS['product-marketing'],copywriting:{skill_sha256:'13c580c2432a4499e9dfdcf5d553df7aa6589e90cf5bd869fb4fbde5caf9f567',tree_sha256:'e03f9c1f236b8e8a6ecd15afb29eb21aad2fd8ea18d044ce31c9f76d9976f626'}} as const;
export type CarouselInput={task:'carousel';brand:CreativeInput['brand'];prompt:string;channel:'linkedin'|'instagram';slide_count:number};
export type CarouselPlan={title:string;caption:string;visual_direction:string;palette:string[];warnings:string[];slides:{position:number;headline:string;body:string;cta:string;image_prompt:string;alt_text:string;fact_ids:string[]}[]};
export type CarouselResult=Omit<SkillResult,'brief'>&{plan:CarouselPlan};
const exact=(v:any,fields:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===fields.sort().join(',');
const text=(v:any,max:number,empty=false)=>typeof v==='string'&&(empty||v.trim().length>0)&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export function validateCarouselInput(input:any):asserts input is CarouselInput{
 const fail=():never=>{throw new CreativeError('CAROUSEL_INPUT_INVALID');};
 if(!exact(input,['task','brand','prompt','channel','slide_count'])||input.task!=='carousel'||!text(input.prompt,4000)||!['linkedin','instagram'].includes(input.channel)||!Number.isInteger(input.slide_count)||input.slide_count<2||input.slide_count>10)fail();
 const b=input.brand;if(!b||!exact(b,['id','sha256','facts',...(b.learning!==undefined?['learning']:[])])||!text(b.id,120)||typeof b.sha256!=='string'||!/^[a-f0-9]{64}$/.test(b.sha256)||!Array.isArray(b.facts)||!b.facts.length||b.facts.length>200||b.facts.some((f:any)=>!exact(f,['id','field','value'])||!text(f.id,120)||!text(f.field,160)||!text(f.value,6000))||new Set(b.facts.map((f:any)=>f.id)).size!==b.facts.length||(b.learning!==undefined&&!validLearning(b.learning))||Buffer.byteLength(JSON.stringify(input))>250000)fail();
}
export function carouselSlideBrief(plan:CarouselPlan,index:number):CreativeBrief{
 const slide=plan.slides[index];if(!slide)throw new CreativeError('CAROUSEL_SLIDE_MISSING');
 return {headline:slide.headline,body:slide.body,cta:slide.cta,caption:plan.caption,image_prompt:`Shared carousel visual direction:\n${plan.visual_direction}\nSlide ${index+1} of ${plan.slides.length}:\n${slide.image_prompt}`,palette:plan.palette,fact_ids:slide.fact_ids,warnings:plan.warnings};
}
export function validateCarouselPlan(value:any,input:CarouselInput):CarouselPlan{
 validateCarouselInput(input);const fail=():never=>{throw new CreativeError('CAROUSEL_PLAN_INVALID');};
 if(!exact(value,['title','caption','visual_direction','palette','warnings','slides'])||!text(value.title,140)||!text(value.caption,3000)||!text(value.visual_direction,2000)||!Array.isArray(value.palette)||value.palette.length!==2||value.palette.some((c:any)=>typeof c!=='string'||!/^#[a-f0-9]{6}$/i.test(c))||!Array.isArray(value.warnings)||value.warnings.length>10||value.warnings.some((w:any)=>!text(w,500))||!Array.isArray(value.slides)||value.slides.length!==input.slide_count||Buffer.byteLength(JSON.stringify(value))>65000)fail();
 const seen=new Set();for(const [index,s] of value.slides.entries()){
  if(!exact(s,['position','headline','body','cta','image_prompt','alt_text','fact_ids'])||s.position!==index+1||!text(s.headline,140)||!text(s.body,500,true)||!text(s.cta,80,true)||!text(s.image_prompt,3000)||!text(s.alt_text,1000)||!Array.isArray(s.fact_ids)||!s.fact_ids.length||s.fact_ids.length>20||new Set(s.fact_ids).size!==s.fact_ids.length||s.fact_ids.some((id:any)=>!input.brand.facts.some(f=>f.id===id)))fail();
  const signature=[s.headline,s.body,s.image_prompt].map((x:string)=>x.trim().toLowerCase().replace(/\s+/g,' ')).join('|');if(seen.has(signature))fail();seen.add(signature);
  try{validateBrief(carouselSlideBrief(value,index),{brand:input.brand,prompt:input.prompt,channel:input.channel,format:'static',parent:null});}catch{fail();}
 }
 return value;
}
export function validateCarouselResult(value:any,input:CarouselInput):CarouselResult{
 const fail=():never=>{throw new CreativeError('CAROUSEL_SKILL_OUTPUT_INVALID');};
 if(!exact(value,['type','version','plan','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!=='deepagents-0.7.29/desvio-carousel-v1'||value.helpers_executed!==false||!Number.isInteger(value.model_calls)||value.model_calls<1||value.model_calls>3||!Array.isArray(value.skills)||value.skills.map((s:any)=>s?.name).sort().join(',')!==Object.keys(CAROUSEL_SKILLS).sort().join(',')||!Array.isArray(value.reads)||value.reads.length>50)fail();
 for(const s of value.skills){const pin=CAROUSEL_SKILLS[s.name as keyof typeof CAROUSEL_SKILLS];if(!pin||s.skill_sha256!==pin.skill_sha256||s.tree_sha256!==pin.tree_sha256||!value.reads.includes(`/skills/${s.name}/SKILL.md`))fail();}
 if(value.reads.some((p:any)=>typeof p!=='string'||p.includes('..')||(p!=='/.agents/product-marketing.md'&&!Object.keys(CAROUSEL_SKILLS).some(s=>p.startsWith(`/skills/${s}/`)))))fail();
 validateCarouselPlan(value.plan,input);return value;
}
