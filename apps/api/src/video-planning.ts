import {validLearning} from './learning-context.js';
import {CreativeError,type CreativeInput,type SkillResult} from './creative-contracts.js';
import {CREATIVE_SKILLS} from './creative-skill-pins.js';
export const VIDEO_SKILLS={
 "brand-engine":CREATIVE_SKILLS["brand-engine"],
 video:{skill_sha256:'0a35e32dda553707996bf383c00ecf971d05127d35d5d814577457c23a3ab591',tree_sha256:'76696e47ce406b06143b50a08d75effa0a5dfd109f12beb86fd5e3d1b68900f1'},
 'ad-creative':CREATIVE_SKILLS['ad-creative'],'product-marketing':CREATIVE_SKILLS['product-marketing'],social:CREATIVE_SKILLS.social,
};
export type VideoPlanningInput={task:'video';brand:CreativeInput['brand'];prompt:string;channel:'linkedin'|'instagram'|'facebook';duration_seconds:number;
 reference:{kind:'image'|'video';sha256:string;width:number;height:number;duration_seconds:number|null;caption:string}};
export type VideoBrief={title:string;caption:string;video_prompt:string;fact_ids:string[];warnings:string[];
 beats:{start_ms:number;end_ms:number;action:string;camera:string}[];
 overlays:{text:string;start_ms:number;end_ms:number;position:'top'|'bottom';foreground:string;background:string}[]};
export type VideoPlanningResult=Omit<SkillResult,'brief'> & {brief:VideoBrief};
const fields=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const plain=(v:any,max:number,empty=false)=>typeof v==='string'&&(empty||!!v.trim())&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const sha=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=(v:any)=>Number.isSafeInteger(v)&&v>=0;
export function validateVideoInput(v:any):asserts v is VideoPlanningInput {
 const fail=()=>{throw new CreativeError('VIDEO_PLAN_INPUT_INVALID');};
 if(!fields(v,['task','brand','prompt','channel','duration_seconds','reference'])||v.task!=='video'||!plain(v.prompt,4000)||!['linkedin','instagram','facebook'].includes(v.channel)||!Number.isInteger(v.duration_seconds)||v.duration_seconds<3||v.duration_seconds>15)fail();
 if(!fields(v.brand,['id','sha256','facts',...(v.brand?.learning===undefined?[]:['learning'])])||(v.brand.learning!==undefined&&!validLearning(v.brand.learning))||!plain(v.brand.id,100)||!sha(v.brand.sha256)||!Array.isArray(v.brand.facts)||!v.brand.facts.length||v.brand.facts.length>200||v.brand.facts.some((f:any)=>!fields(f,['id','field','value'])||!plain(f.id,100)||!plain(f.field,100)||!plain(f.value,4000))||new Set(v.brand.facts.map((f:any)=>f.id)).size!==v.brand.facts.length)fail();
 const r=v.reference;
 if(!fields(r,['kind','sha256','width','height','duration_seconds','caption'])||!['image','video'].includes(r.kind)||!sha(r.sha256)||![r.width,r.height].every(n=>Number.isInteger(n)&&n>=64&&n<=4096)||!plain(r.caption,3000,true)||(r.kind==='image'?r.duration_seconds!==null:typeof r.duration_seconds!=='number'||!Number.isFinite(r.duration_seconds)||r.duration_seconds<1||r.duration_seconds>30))fail();
 if(Buffer.byteLength(JSON.stringify(v))>350000)fail();
}
export function validateVideoBrief(value:any,input:VideoPlanningInput):VideoBrief {
 const fail=()=>{throw new CreativeError('VIDEO_PLAN_OUTPUT_INVALID');};
 validateVideoInput(input);
 if(!fields(value,['title','caption','video_prompt','fact_ids','warnings','beats','overlays'])||!plain(value.title,140)||!plain(value.caption,3000)||!plain(value.video_prompt,8000)||!Array.isArray(value.fact_ids)||!value.fact_ids.length||value.fact_ids.length>20||new Set(value.fact_ids).size!==value.fact_ids.length||value.fact_ids.some((id:any)=>!input.brand.facts.some(f=>f.id===id))||!Array.isArray(value.warnings)||value.warnings.length>10||value.warnings.some((s:any)=>!plain(s,500)))fail();
 const duration=input.duration_seconds*1000;
 if(!Array.isArray(value.beats)||!value.beats.length||value.beats.length>5)fail();
 let end=0;
 for(const beat of value.beats){
  if(!fields(beat,['start_ms','end_ms','action','camera'])||!time(beat.start_ms)||!time(beat.end_ms)||beat.start_ms!==end||beat.end_ms<=end||beat.end_ms>duration||!plain(beat.action,800)||!plain(beat.camera,300))fail();
  end=beat.end_ms;
 }
 if(end!==duration||!Array.isArray(value.overlays)||value.overlays.length>3)fail();
 for(const overlay of value.overlays){
  if(!fields(overlay,['text','start_ms','end_ms','position','foreground','background'])||!plain(overlay.text,90)||!time(overlay.start_ms)||!time(overlay.end_ms)||overlay.end_ms-overlay.start_ms<1000||overlay.end_ms>duration||!['top','bottom'].includes(overlay.position)||![overlay.foreground,overlay.background].every(c=>typeof c==='string'&&/^#[a-f0-9]{6}$/i.test(c)))fail();
 }
 for(let i=0;i<value.overlays.length;i++)for(let j=i+1;j<value.overlays.length;j++){
  const a=value.overlays[i],b=value.overlays[j];if(a.position===b.position&&a.start_ms<b.end_ms&&b.start_ms<a.end_ms)fail();
 }
 if((value.video_prompt+'\nScript:\n'+value.beats.map((b:any)=>`${b.start_ms}-${b.end_ms}ms: ${b.action} Camera: ${b.camera}`).join('\n')).length>10000)fail();
 return value;
}
export function validateVideoPlanningResult(value:any,input:VideoPlanningInput):VideoPlanningResult {
 if(!fields(value,['type','version','brief','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!=='deepagents-0.7.29/desvio-video-v1'||value.helpers_executed!==false||!Number.isInteger(value.model_calls)||value.model_calls<1||value.model_calls>3||!Array.isArray(value.skills)||value.skills.map((s:any)=>s?.name).sort().join(',')!==Object.keys(VIDEO_SKILLS).sort().join(',')||!Array.isArray(value.reads)||value.reads.length>50)throw new CreativeError('SKILL_OUTPUT_INVALID');
 for(const s of value.skills){const pin=VIDEO_SKILLS[s.name as keyof typeof VIDEO_SKILLS];if(!fields(s,['name','skill_sha256','tree_sha256'])||!pin||s.skill_sha256!==pin.skill_sha256||s.tree_sha256!==pin.tree_sha256||!value.reads.includes(`/skills/${s.name}/SKILL.md`))throw new CreativeError('SKILL_DIGEST_MISMATCH');}
 if(value.reads.some((p:any)=>typeof p!=='string'||p.includes('..')||!p.endsWith('.md')||(p!=='/.agents/product-marketing.md'&&!Object.keys(VIDEO_SKILLS).some(s=>p.startsWith(`/skills/${s}/`)))))throw new CreativeError('SKILL_PATH_DENIED');
 validateVideoBrief(value.brief,input);return value;
}
