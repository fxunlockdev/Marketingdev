import type {VideoBrief} from './video-planning.js';
import type {ReelCaption,ReelEndCard,ReelStyle,VideoTarget} from './video-renderer.js';
import {VideoStateError} from './video-vault.js';
import {RUNWAY_PROMPT_MAX} from './runway-client.js';

/** A multi-shot reel: 2 to 5 Runway clips cut together, with captions and an end card. Pure planning only. */
export const REEL_MIN_SHOTS=2;
export const REEL_MAX_SHOTS=5;
export const REEL_END_CARD_MS=2000;
export type ReelShot={index:number;prompt:string;duration_seconds:number;start_ms:number;end_ms:number};
type StoryShot={visual:string;camera:string;on_screen_text:string};

const flat=(v:unknown):string=>String(v??'').replace(/[\u0000-\u001f\u007f\s]+/g,' ').trim();

/** The reviewed storyline's shots, when the post has a video storyline. */
export function storyShots(storyline:unknown):StoryShot[]{
 const s=storyline as {kind?:unknown;shots?:unknown}|null;
 if(s?.kind!=='video'||!Array.isArray(s.shots))return [];
 return (s.shots as StoryShot[]).filter(x=>x&&typeof x==='object').map(x=>({visual:flat(x.visual),camera:flat(x.camera),on_screen_text:flat(x.on_screen_text)}));
}

/** Seconds per shot so the cut reel lasts 15 s or more (before the end card) without exceeding 10 s a shot. */
export function reelShotSeconds(planned:number,shots:number):number{
 if(!Number.isInteger(planned)||planned<3||planned>15||!Number.isInteger(shots)||shots<REEL_MIN_SHOTS||shots>REEL_MAX_SHOTS)throw new VideoStateError('VIDEO_REEL_INVALID');
 return Math.min(10,Math.max(3,Math.ceil(Math.max(planned,15)/shots)));
}

/** Runway prompt for each shot: the approved overall direction, then this shot's reviewed visual and camera,
 * then the approved beats that fall inside it. Never shortened: an over-long prompt is refused by name. */
export function reelShots(brief:VideoBrief,storyline:unknown,count:number,planned:number):ReelShot[]{
 const seconds=reelShotSeconds(planned,count),story=storyShots(storyline),plannedMs=planned*1000;
 return Array.from({length:count},(_,i)=>{
  const from=Math.floor(i*plannedMs/count),to=Math.floor((i+1)*plannedMs/count);
  const beats=brief.beats.filter(b=>b.start_ms<to&&b.end_ms>from);
  const shot=story[i];
  const lines=[brief.video_prompt,`Shot ${i+1} of ${count} (${seconds} seconds), one continuous take from the opening frame.`];
  if(shot)lines.push(`Shot: ${shot.visual} Camera: ${shot.camera}.`);
  if(beats.length)lines.push('Script:',...beats.map(b=>`${b.action} Camera: ${b.camera}`));
  const prompt=lines.join('\n');
  if(prompt.length>RUNWAY_PROMPT_MAX)throw new VideoStateError('RUNWAY_PROMPT_TOO_LONG');
  return {index:i,prompt,duration_seconds:seconds,start_ms:i*seconds*1000,end_ms:(i+1)*seconds*1000};
 });
}

/** Split text into caption lines of at most `limit` characters at word boundaries; nothing is dropped. */
export function captionLines(text:string,limit=120):string[]{
 const words=flat(text).split(' ').filter(Boolean),lines:string[]=[];let line='';
 for(const word of words){
  const pieces=word.length>limit?word.match(new RegExp(`.{1,${limit}}`,'g'))!:[word];
  for(const piece of pieces){if(line&&line.length+1+piece.length>limit){lines.push(line);line=piece;}else line=line?`${line} ${piece}`:piece;}
 }
 if(line)lines.push(line);
 return lines;
}

/** Burned-in captions from the approved script, one window per shot (split evenly when a shot carries
 * several lines). Falls back to the storyline's on-screen text. Returns [] when there is no script. */
export function reelCaptions(script:string|null|undefined,storyline:unknown,shots:ReelShot[]):ReelCaption[]{
 const sentences=flat(script).split(/(?<=[.!?])\s+/).filter(Boolean);
 const story=storyShots(storyline);
 const perShot:string[][]=shots.map(()=>[]);
 if(sentences.length){sentences.forEach((s,i)=>perShot[Math.min(shots.length-1,Math.floor(i*shots.length/sentences.length))]!.push(s));}
 else story.slice(0,shots.length).forEach((s,i)=>{if(s.on_screen_text)perShot[i]!.push(s.on_screen_text);});
 const captions:ReelCaption[]=[];
 for(const shot of shots){
  const lines=perShot[shot.index]!.flatMap(t=>captionLines(t));
  if(!lines.length)continue;
  const span=shot.end_ms-shot.start_ms,step=Math.floor(span/lines.length/100)*100;
  if(step<800)throw new VideoStateError('VIDEO_CAPTION_TOO_LONG');
  lines.forEach((text,i)=>captions.push({text,start_ms:shot.start_ms+i*step,end_ms:i===lines.length-1?shot.end_ms:shot.start_ms+(i+1)*step}));
 }
 if(captions.length>12)throw new VideoStateError('VIDEO_CAPTION_TOO_LONG');
 return captions;
}

/** Overlays planned on the planning timeline, stretched onto the reel timeline (100 ms grid). */
export function reelOverlays(brief:VideoBrief,planned:number,shots:ReelShot[]):VideoBrief['overlays']{
 const total=shots[shots.length-1]!.end_ms,scale=total/(planned*1000);
 return brief.overlays.map(o=>({...o,start_ms:Math.round(o.start_ms*scale/100)*100,end_ms:Math.min(total,Math.round(o.end_ms*scale/100)*100)}));
}

/** End card in brand colours: the brand name and the post's call to action. */
export function reelEndCard(brand:string,cta:string,colors:{foreground:string;background:string}):ReelEndCard{
 return {headline:captionLines(brand,60)[0]??'',cta:captionLines(cta,60)[0]??'',foreground:colors.foreground,background:colors.background,duration_ms:REEL_END_CARD_MS};
}

/** Brand fonts map onto the renderer's fixed families: serif display faces to serif, everything else to sans. */
export function reelStyle(fontFamily:string|null|undefined,colors:{foreground:string;background:string},legible=false):ReelStyle{
 const serif=/serif|garamond|playfair|georgia|times|baskerville|didot|bodoni|merriweather|lora/i.test(String(fontFamily??''))&&!/sans/i.test(String(fontFamily??''));
 return {font:serif?'serif':'sans',caption_scale:legible?130:100,caption_foreground:colors.foreground,caption_background:colors.background,caption_opacity:legible?100:70};
}

/** Frames sampled for vision QA: the middle of each shot that carries a caption, and the end card. */
export function reelSamples(shots:ReelShot[],captions:ReelCaption[],endCard:boolean):number[]{
 const at=shots.filter(s=>captions.some(c=>c.start_ms>=s.start_ms&&c.end_ms<=s.end_ms)).map(s=>{const c=captions.find(x=>x.start_ms>=s.start_ms)!;return Math.round((c.start_ms+c.end_ms)/2);});
 const last=shots[shots.length-1]!.end_ms;
 return [...at,...(endCard?[last+REEL_END_CARD_MS/2]:[])].slice(0,6);
}

/** Final frame for a video post. Portrait video is a true 4:5 at the 1080x1350 export size. */
export function videoTarget(aspect:string|null|undefined):VideoTarget{
 return aspect==='square'?{width:1024,height:1024}:aspect==='landscape'?{width:1536,height:1024}:aspect==='portrait'?{width:1080,height:1350}:{width:1080,height:1920};
}

export type BrandPalette={caption:{foreground:string;background:string};card:{foreground:string;background:string}};
const luminance=(hex:string):number=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);return 0.2126*r!+0.7152*g!+0.0722*b!;};
/** Caption and end-card colours from the approved brand colours. Captions stay legible: light text on
 * the brand colour only when it is dark enough, otherwise on near-black. */
export function brandPalette(facts:{field:string;value:string}[]):BrandPalette{
 const hex=facts.filter(f=>f.field==='colors').flatMap(f=>f.value.match(/#[0-9a-f]{6}\b/gi)??[]).map(h=>h.toLowerCase());
 const primary=hex[0]??'#111111',dark=luminance(primary)<0.18;
 return {caption:{foreground:'#ffffff',background:dark?primary:'#111111'},card:{background:primary,foreground:luminance(primary)>0.4?'#111111':'#ffffff'}};
}
/** The brand's first named font, used to pick the renderer's serif or sans family. */
export function brandFont(facts:{field:string;value:string}[]):string|null{
 return facts.find(f=>f.field==='fonts')?.value??null;
}
export function brandName(facts:{field:string;value:string}[]):string{
 return facts.find(f=>f.field==='brand_name')?.value.trim()||'';
}
