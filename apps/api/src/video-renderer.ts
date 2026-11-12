import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {digest,MAX_CANONICAL_VIDEO_BYTES} from './object-store.js';
import {VideoStateError} from './video-vault.js';
import type {VideoBrief} from './video-planning.js';
export const VIDEO_RENDER_VERSION='desvio-video-render-v4/ffmpeg-7.1.5';
/** Final frame sizes the renderer composes: square, 2:3 and 4:5 portrait, landscape and 9:16. */
export const VIDEO_TARGETS=['1024x1024','1024x1536','1536x1024','1080x1920','1024x1280','1080x1350'] as const;
export type VideoTarget={width:number;height:number};
export type ReelCaption={text:string;start_ms:number;end_ms:number};
export type ReelEndCard={headline:string;cta:string;foreground:string;background:string;duration_ms:number};
export type ReelStyle={font:'sans'|'serif';caption_scale:100|130;caption_foreground:string;caption_background:string;caption_opacity:70|100};
export type ReelRequest={clips:{bytes:Buffer;duration_seconds:number}[];target:VideoTarget;captions:ReelCaption[];overlays:VideoBrief['overlays'];end_card:ReelEndCard|null;style:ReelStyle;samples:number[]};
export type ReelFrame={at_ms:number;sha256:string;bytes:Buffer};
const validTarget=(t:unknown):t is VideoTarget=>!!t&&typeof t==='object'&&Object.keys(t).sort().join(',')==='height,width'&&(VIDEO_TARGETS as readonly string[]).includes(`${(t as VideoTarget).width}x${(t as VideoTarget).height}`);
export function validateVideoOverlays(overlays:VideoBrief['overlays'],duration:number,totalMs=duration*1000){
 if(!Number.isInteger(duration)||duration<3||duration>15||!Number.isSafeInteger(totalMs)||totalMs>60000||!Array.isArray(overlays)||overlays.length>3)throw new VideoStateError('VIDEO_OVERLAY_INVALID');
 for(const o of overlays){
  if(!o||Object.keys(o).sort().join(',')!==['text','start_ms','end_ms','position','foreground','background'].sort().join(',')||typeof o.text!=='string'||!o.text.trim()||[...o.text].length>90||/[\x00-\x1f\x7f]/.test(o.text)||!['top','bottom'].includes(o.position)||![o.foreground,o.background].every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c))||![o.start_ms,o.end_ms].every(Number.isSafeInteger)||o.start_ms<0||o.end_ms-o.start_ms<1000||o.end_ms>totalMs)throw new VideoStateError('VIDEO_OVERLAY_INVALID');
 }
 for(let i=0;i<overlays.length;i++)for(let j=i+1;j<overlays.length;j++){const a=overlays[i],b=overlays[j];if(a.position===b.position&&a.start_ms<b.end_ms&&b.start_ms<a.end_ms)throw new VideoStateError('VIDEO_OVERLAY_INVALID');}
}
function decode(value:any,mime:string,max:number){
 if(!value||value.mime!==mime||typeof value.base64!=='string'||value.base64.length>Math.ceil(max/3)*4||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
 const bytes=Buffer.from(value.base64,'base64');
 if(bytes.length<24||bytes.length>max||bytes.toString('base64')!==value.base64||digest(bytes)!==value.sha256)throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
 return bytes;
}
export class VideoRenderer {
 constructor(readonly image?:string){}
 get configured(){return !!this.image&&/^sha256:[a-f0-9]{64}$/.test(this.image);}
 async render(bytes:Buffer,duration:number,overlays:VideoBrief['overlays']=[],target?:{width:number;height:number}){
  if(!this.configured)throw new VideoStateError('VIDEO_RENDERER_NOT_CONFIGURED');
  validateVideoOverlays(overlays,duration);
  if(target&&!validTarget(target))throw new VideoStateError('VIDEO_TARGET_INVALID');
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_CANONICAL_VIDEO_BYTES||bytes.subarray(4,8).toString()!=='ftyp')throw new VideoStateError('VIDEO_MEDIA_INPUT_INVALID');
  const inputHash=digest(bytes);
  const value:any=await this.sandbox({version:1,input_base64:bytes.toString('base64'),input_sha256:inputHash,expected_duration_seconds:duration,overlays,...(target?{target}:{})},190000);
   const m=value?.metadata;
   if(value?.type!=='result'||value.version!==VIDEO_RENDER_VERSION||value.input_sha256!==inputHash||JSON.stringify(value.overlays)!==JSON.stringify(overlays)||!m||m.codec!=='h264'||typeof m.audio!=='boolean'||![m.width,m.height,m.duration_ms].every(Number.isSafeInteger)||m.width<64||m.height<64||Math.max(m.width,m.height)>1920||Math.min(m.width,m.height)>1080||m.width%2||m.height%2||Math.abs(m.duration_ms-duration*1000)>250)throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   if(target&&(m.width!==target.width||m.height!==target.height||value.target?.width!==target.width||value.target?.height!==target.height))throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   const video=decode(value.video,'video/mp4',MAX_CANONICAL_VIDEO_BYTES),poster=decode(value.poster,'image/png',2*1024*1024);
   if(video.subarray(4,8).toString()!=='ftyp')throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   const pm=await sharp(poster,{limitInputPixels:640*640}).metadata();
   if(pm.format!=='png'||!pm.width||!pm.height||pm.width>640||pm.height>640||Math.abs(pm.width*m.height-pm.height*m.width)>Math.max(m.width,m.height))throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   await sharp(poster,{limitInputPixels:640*640}).raw().toBuffer();
  return {video,poster,metadata:m,manifest:{version:value.version,image:this.image,input_sha256:inputHash,video_sha256:value.video.sha256,poster_sha256:value.poster.sha256,metadata:{codec:m.codec,audio:m.audio,width:m.width,height:m.height,duration_ms:m.duration_ms},overlays,...(target?{target,framing:'contain'}:{})}};
 }
 /** Joins canonical shot clips with hard cuts, burns in captions and overlays at the output size,
  * appends the end card and lays a silent stereo bed. Returns sampled frames for quality checks. */
 async renderReel(request:ReelRequest){
  if(!this.configured)throw new VideoStateError('VIDEO_RENDERER_NOT_CONFIGURED');
  const {clips,target,captions,overlays,end_card:card,style,samples}=request;
  if(!Array.isArray(clips)||clips.length<1||clips.length>5||!validTarget(target)||!Array.isArray(samples)||samples.length>6)throw new VideoStateError('VIDEO_REEL_INVALID');
  for(const clip of clips)if(!Buffer.isBuffer(clip.bytes)||clip.bytes.length<24||clip.bytes.length>MAX_CANONICAL_VIDEO_BYTES||clip.bytes.subarray(4,8).toString()!=='ftyp'||!Number.isInteger(clip.duration_seconds)||clip.duration_seconds<3||clip.duration_seconds>15)throw new VideoStateError('VIDEO_MEDIA_INPUT_INVALID');
  const shotsMs=clips.reduce((n,c)=>n+c.duration_seconds*1000,0),total=shotsMs+(card?.duration_ms??0);
  validateReelCaptions(captions,shotsMs);validateVideoOverlays(overlays,Math.min(15,Math.floor(total/1000)),total);
  const inputs=clips.map(c=>({input_base64:c.bytes.toString('base64'),input_sha256:digest(c.bytes),duration_seconds:c.duration_seconds}));
  const value:any=await this.sandbox({version:2,mode:'reel',clips:inputs,target,captions,overlays,end_card:card,style,audio:{bed:'silence'},samples},310000);
  const m=value?.metadata;
  if(value?.type!=='result'||value.version!==VIDEO_RENDER_VERSION||value.mode!=='reel'||JSON.stringify(value.inputs)!==JSON.stringify(inputs.map(i=>i.input_sha256))||JSON.stringify(value.captions)!==JSON.stringify(captions)||JSON.stringify(value.overlays)!==JSON.stringify(overlays)||!m||m.codec!=='h264'||m.audio!==true||m.width!==target.width||m.height!==target.height||Math.abs(m.duration_ms-total)>250||typeof value.fps!=='number'||!(value.fps>=1&&value.fps<=60)||!Array.isArray(value.samples)||value.samples.length!==samples.length)throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
  const video=decode(value.video,'video/mp4',MAX_CANONICAL_VIDEO_BYTES),poster=decode(value.poster,'image/png',2*1024*1024);
  if(video.subarray(4,8).toString()!=='ftyp')throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
  await sharp(poster,{limitInputPixels:640*640}).raw().toBuffer();
  const frames:ReelFrame[]=[];
  for(const [i,sample] of value.samples.entries()){
   if(sample?.at_ms!==samples[i])throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   const bytes=decode(sample,'image/png',4*1024*1024),meta=await sharp(bytes,{limitInputPixels:1024*1024}).metadata();
   if(meta.format!=='png'||!meta.width||!meta.height||Math.max(meta.width,meta.height)>1024)throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   frames.push({at_ms:samples[i]!,sha256:sample.sha256,bytes});
  }
  return {video,poster,frames,metadata:{...m,fps:value.fps},manifest:{version:value.version,image:this.image,mode:'reel' as const,inputs:inputs.map(i=>i.input_sha256),video_sha256:value.video.sha256,poster_sha256:value.poster.sha256,metadata:{codec:m.codec,audio:m.audio,width:m.width,height:m.height,duration_ms:m.duration_ms,fps:value.fps},captions,overlays,end_card:card,style,audio:{bed:'silence' as const,voiceover:null},target,framing:'contain' as const}};
 }
 private async sandbox(payload:unknown,timeoutMs:number):Promise<any>{
  const name=`desvio-video-render-${randomUUID()}`;
  try{
   return await new Promise((resolve,reject)=>{
    const child=spawn('docker',['run','--rm','-i','--name',name,'--label','desvio.purpose=video-render-sandbox','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','2g','--memory-swap','2g','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=512m',this.image!],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
    const chunks:Buffer[]=[];let total=0,done=false;
    const finish=(error?:Error,result?:unknown)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.destroy();if(error){child.kill('SIGKILL');reject(error);}else resolve(result);};
    const timer=setTimeout(()=>finish(new VideoStateError('VIDEO_RENDER_TIMEOUT')),timeoutMs);
    child.on('error',()=>finish(new VideoStateError('VIDEO_RENDERER_UNAVAILABLE')));child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>120*1024*1024)return finish(new VideoStateError('VIDEO_RENDER_OUTPUT_LIMIT'));chunks.push(chunk);});
    child.on('close',code=>{try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(v.type==='error')return finish(new VideoStateError(typeof v.code==='string'&&/^VIDEO_[A-Z_]{1,80}$/.test(v.code)?v.code:'VIDEO_RENDER_FAILED'));if(code!==0)return finish(new VideoStateError('VIDEO_RENDER_FAILED'));finish(undefined,v);}catch{finish(new VideoStateError('VIDEO_RENDER_FAILED'));}});
    child.stdin.end(JSON.stringify(payload));
   });
  }finally{await promisify(execFile)('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});}
 }
}
/** Captions are ordered, non-overlapping, at least 0.8 s long and inside the shots (never the end card). */
export function validateReelCaptions(captions:ReelCaption[],shotsMs:number):void{
 if(!Array.isArray(captions)||captions.length>12)throw new VideoStateError('VIDEO_CAPTION_INVALID');
 let end=0;
 for(const c of captions){
  if(!c||Object.keys(c).sort().join(',')!=='end_ms,start_ms,text'||typeof c.text!=='string'||!c.text.trim()||[...c.text].length>120||/[\x00-\x1f\x7f]/.test(c.text)||![c.start_ms,c.end_ms].every(Number.isSafeInteger)||c.start_ms<end||c.end_ms-c.start_ms<800||c.end_ms>shotsMs)throw new VideoStateError('VIDEO_CAPTION_INVALID');
  end=c.end_ms;
 }
}
