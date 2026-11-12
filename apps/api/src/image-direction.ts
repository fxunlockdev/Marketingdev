import {CAMPAIGN_CREATIVE_PREFIX} from './campaign-design.js';

/** The customer-approved creative direction that every image generator must follow:
 * the locked mood board, plus the campaign style saved with a planned post.
 * Returned as bounded plain data for the image prompt; never treated as instructions. */
export type ApprovedMoodboard={direction:unknown;feedback:unknown};
export type ApprovedDirection={moodboard?:Record<string,unknown>;campaign?:Record<string,unknown>};

const text=(value:unknown,max:number):string|undefined=>{
 if(typeof value!=='string')return undefined;
 const clean=value.replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
 return clean||undefined;
};
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const compact=(value:Record<string,unknown>):Record<string,unknown>=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined&&!(Array.isArray(item)&&!item.length)));

function moodboardDirection(board?:ApprovedMoodboard|null):Record<string,unknown>|undefined{
 const d=record(board?.direction);
 if(!d)return undefined;
 const palette=Array.isArray(d.palette)?d.palette.flatMap(colour=>{
  const c=record(colour),hex=text(c?.hex,7),role=text(c?.role,20);
  return hex&&/^#[0-9a-f]{6}$/i.test(hex)?[{role:role??'colour',hex}]:[];
 }).slice(0,3):[];
 const result=compact({summary:text(d.summary,400),imagery:text(d.imagery,600),voice:text(d.voice,200),palette,heading_font:text(d.heading_font,80),body_font:text(d.body_font,80),customer_feedback:text(board?.feedback,650)});
 return Object.keys(result).length?result:undefined;
}

function campaignDirection(prompt:string):Record<string,unknown>|undefined{
 if(!prompt.startsWith(CAMPAIGN_CREATIVE_PREFIX))return undefined;
 let saved:Record<string,unknown>|null;
 try{saved=record(JSON.parse(prompt.slice(CAMPAIGN_CREATIVE_PREFIX.length)));}catch{return undefined;}
 const design=record(saved?.design_direction),context=record(saved?.campaign_context);
 const result=compact({theme:text(context?.theme,1200),style:text(design?.style,400),creative_freedom:text(design?.creative_freedom,400),typography:text(design?.typography,300)});
 return Object.keys(result).length?result:undefined;
}

export function approvedDirection(board:ApprovedMoodboard|null|undefined,requestPrompt:string):ApprovedDirection|null{
 const moodboard=moodboardDirection(board),campaign=campaignDirection(requestPrompt);
 return moodboard||campaign?{...(moodboard?{moodboard}:{}),...(campaign?{campaign}:{})}:null;
}
