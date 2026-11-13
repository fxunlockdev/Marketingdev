import {ConflictException} from '@nestjs/common';
import type {PoolClient} from 'pg';
import {directionPromptBlock,type BrandDirection} from './brand-direction.js';
import {currentDirection} from './brand-directions.js';

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

export type ApprovedDirection={
 moodboard:{palette:string[];heading_font:string;body_font:string;voice:string;imagery:string;summary:string;feedback:string}|null;
 creative_brief:{markets?:string;languages?:string;timing?:string;direction?:string}|null;
 /** The owner's creative direction (looks and Brand Kit). When present it replaces the mood board. */
 brand_direction?:BrandDirection|null;
};
const text=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
/** The creative direction (else the locked mood board) and saved creative brief for a business, or null when none exists. */
export async function approvedDirection(db:Pick<PoolClient,'query'>,organization:string,brand:string):Promise<ApprovedDirection|null>{
 const board=(await db.query('SELECT direction,feedback FROM app.guided_moodboards WHERE organization_id=$1 AND brand_id=$2 AND approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1',[organization,brand])).rows[0];
 const saved=(await db.query('SELECT creative_brief FROM app.business_onboarding WHERE organization_id=$1 AND brand_id=$2',[organization,brand])).rows[0]?.creative_brief;
 const d=board?.direction;
 const moodboard=d&&typeof d==='object'?{palette:Array.isArray(d.palette)?d.palette.map((c:{hex?:unknown})=>text(c?.hex,7)).filter((hex:string)=>/^#[0-9a-f]{6}$/i.test(hex)).slice(0,3):[],heading_font:text(d.heading_font,60),body_font:text(d.body_font,60),voice:text(d.voice,400),imagery:text(d.imagery,800),summary:text(d.summary,800),feedback:text(board.feedback,1200)}:null;
 const brief=saved&&typeof saved==='object'?Object.fromEntries((['markets','languages','timing','direction'] as const).map(key=>[key,text(saved[key],600)]).filter(([,value])=>value)):null;
 const creative_brief=brief&&Object.keys(brief).length?brief:null;
 const brand_direction=(await currentDirection(db,organization,brand))?.direction??null;
 if(brand_direction)return {moodboard:null,creative_brief,brand_direction};
 return moodboard||creative_brief?{moodboard,creative_brief}:null;
}
const DIRECTION_PRIORITY='Apply after approved brand facts. Brand facts win any conflict.';
/** The largest approved-direction block that fits in `room` characters of JSON,
 * so a long brief degrades the direction instead of failing the request. */
export function directionPromptContext(source:ApprovedDirection|null|undefined,room:number):Record<string,unknown>|undefined{
 if(!source)return undefined;
 const m=source.moodboard,b=source.creative_brief,d=source.brand_direction;
 const build=(voice:number,imagery:number,feedback:number,brief:number)=>{
  if(d){
   const look=voice?directionPromptBlock(d,voice>=200?'full':'short'):{palette_roles:d.palette,heading_font:`${d.heading_font} ${d.heading_weight}`,body_font:`${d.body_font} ${d.body_weight}`,layout_archetype:d.layout_archetype};
   const saved=b&&brief?Object.fromEntries(Object.entries(b).map(([key,value])=>[key,String(value).slice(0,brief)])):null;
   return {priority:DIRECTION_PRIORITY,creative_direction:look,...(saved&&Object.keys(saved).length?{creative_brief:saved}:{})};
  }
  const mood=m?{...(m.palette.length?{palette:m.palette}:{}),...(m.heading_font?{heading_font:m.heading_font}:{}),...(m.body_font?{body_font:m.body_font}:{}),...(voice&&m.voice?{voice:m.voice.slice(0,voice)}:{}),...(imagery&&m.imagery?{imagery:m.imagery.slice(0,imagery)}:{}),...(feedback&&m.feedback?{customer_feedback:m.feedback.slice(0,feedback)}:{})}:null;
  const saved=b&&brief?Object.fromEntries(Object.entries(b).map(([key,value])=>[key,String(value).slice(0,brief)])):null;
  if(!(mood&&Object.keys(mood).length)&&!(saved&&Object.keys(saved).length))return undefined;
  return {priority:DIRECTION_PRIORITY,...(mood&&Object.keys(mood).length?{mood_board:mood}:{}),...(saved&&Object.keys(saved).length?{creative_brief:saved}:{})};
 };
 for(const [voice,imagery,feedback,brief] of [[200,320,240,200],[120,200,120,100],[0,120,0,0],[0,0,0,0]]){
  const block=build(voice,imagery,feedback,brief);
  if(block&&JSON.stringify(block).length<=room)return block;
 }
 return undefined;
}
