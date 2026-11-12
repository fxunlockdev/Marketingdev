import sharp from 'sharp';
import {hash} from './brand-brain.js';
import {CreativeJobs} from './creative-jobs.js';
import {CreativeError} from './creative-contracts.js';
import {QA_UNAVAILABLE,qaReport,settleVerdict,type QaAttempt,type QaExpectation,type QaReport} from './image-qa.js';
import type {JobScope} from './jobs.js';
import type {ReelCaption,ReelEndCard,ReelFrame} from './video-renderer.js';
import type {VideoBrief} from './video-planning.js';

const FRAME_HEIGHT=768;
const SHEET_QUALITY=85;

/** Sampled reel frames side by side in time order, large enough to read captions. One image keeps one
 * vision call per render; frames are never upscaled. */
export async function contactSheet(frames:ReelFrame[]):Promise<Buffer>{
 if(!frames.length||frames.length>6)throw new CreativeError(QA_UNAVAILABLE);
 const tiles=await Promise.all(frames.map(f=>sharp(f.bytes,{limitInputPixels:1024*1024}).resize({height:FRAME_HEIGHT,withoutEnlargement:true}).flatten({background:'#000000'}).png().toBuffer({resolveWithObject:true})));
 const gap=16,width=tiles.reduce((n,t)=>n+t.info.width,0)+gap*(tiles.length-1),height=Math.max(...tiles.map(t=>t.info.height));
 let left=0;const composite=tiles.map(t=>{const at={input:t.data,left,top:0};left+=t.info.width+gap;return at;});
 return sharp({create:{width,height,channels:3,background:'#808080'}}).composite(composite).jpeg({quality:SHEET_QUALITY}).toBuffer();
}

/** What a reel's sampled frames must show: every caption and the end card's words, spelled exactly. */
export function reelExpectation(input:{frames:ReelFrame[];captions:ReelCaption[];overlays:VideoBrief['overlays'];endCard:ReelEndCard|null;endCardAt:number|null;videoPrompt:string;facts:{field:string;value:string}[]}):QaExpectation{
 const shown=input.frames.flatMap(f=>input.captions.filter(c=>c.start_ms<=f.at_ms&&f.at_ms<c.end_ms).map(c=>c.text));
 const card=input.endCard&&input.frames.some(f=>f.at_ms===input.endCardAt)?[input.endCard.headline,input.endCard.cta].filter(Boolean):[];
 const brand=input.facts.find(f=>f.field==='brand_name')?.value.trim().slice(0,80);
 return {
  text_mode:'in_image',
  expected_text:[...new Set([...shown,...card])],
  allowed_text:[...new Set([...(brand?[brand]:[]),...input.overlays.map(o=>o.text)])],
  creative_task:(`A contact sheet of ${input.frames.length} frames sampled in time order from one social video reel, separated by grey bars. Burned-in captions sit in the lower third; the last frame may be the end card. Judge caption legibility, visible artefacts and brand fit. Video direction: `+input.videoPrompt).slice(0,3000),
  art_direction:null,
  brand:input.facts.map(f=>({field:f.field,value:f.value.slice(0,600)})),
 };
}

/** Vision check of a rendered reel through the creative ledger (step qa:1, then qa:2 after a re-render).
 * Optional: an unavailable check never blocks the reel and is recorded as such. */
export class ReelQuality{
 constructor(readonly creative:CreativeJobs){}
 get configured():boolean{return !!this.creative.qa?.configured;}
 async attempt(scope:JobScope,step:'qa:1'|'qa:2',frames:ReelFrame[],expectation:QaExpectation):Promise<QaAttempt>{
  const qa=this.creative.qa!,sheet=await contactSheet(frames),media=hash(sheet.toString('base64'));
  try{
   const wire=qa.request(sheet,expectation);
   const finding=await this.creative.call(scope,step,wire.model,wire.sha256,()=>qa.reservation(wire),()=>qa.check(wire),'openai',{optional:true});
   return {step,media_sha256:media,status:'checked',finding};
  }catch(error){
   return {step,media_sha256:media,status:'unavailable',reason:error instanceof CreativeError?error.code:QA_UNAVAILABLE};
  }
 }
 /** Check the first render; when captions do not read exactly, re-render once with the legible caption
 * style (same clips, no regeneration) and check again. Anything else is flagged, never regenerated. */
 async review(scope:JobScope,expectation:QaExpectation,first:ReelFrame[],rerender:()=>Promise<ReelFrame[]>):Promise<{report:QaReport;rerendered:boolean}>{
  const initial=await this.attempt(scope,'qa:1',first,expectation);
  if(initial.status!=='checked'||settleVerdict(initial.finding,expectation)!=='retry')return {report:qaReport(this.creative.qa!.model,expectation,[initial],false),rerendered:false};
  const second=await this.attempt(scope,'qa:2',await rerender(),expectation);
  return {report:qaReport(this.creative.qa!.model,expectation,[initial,second],true),rerendered:true};
 }
}
