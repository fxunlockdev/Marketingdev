import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {digest,MAX_CANONICAL_VIDEO_BYTES} from './object-store.js';
import {VideoStateError} from './video-vault.js';
import type {VideoBrief} from './video-planning.js';
export const VIDEO_RENDER_VERSION='desvio-video-render-v2/ffmpeg-7.1.5';
export function validateVideoOverlays(overlays:VideoBrief['overlays'],duration:number){
 if(!Number.isInteger(duration)||duration<3||duration>15||!Array.isArray(overlays)||overlays.length>3)throw new VideoStateError('VIDEO_OVERLAY_INVALID');
 for(const o of overlays){
  if(!o||Object.keys(o).sort().join(',')!==['text','start_ms','end_ms','position','foreground','background'].sort().join(',')||typeof o.text!=='string'||!o.text.trim()||[...o.text].length>90||/[\x00-\x1f\x7f]/.test(o.text)||!['top','bottom'].includes(o.position)||![o.foreground,o.background].every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c))||![o.start_ms,o.end_ms].every(Number.isSafeInteger)||o.start_ms<0||o.end_ms-o.start_ms<1000||o.end_ms>duration*1000)throw new VideoStateError('VIDEO_OVERLAY_INVALID');
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
 async render(bytes:Buffer,duration:number,overlays:VideoBrief['overlays']=[]){
  if(!this.configured)throw new VideoStateError('VIDEO_RENDERER_NOT_CONFIGURED');
  validateVideoOverlays(overlays,duration);
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>MAX_CANONICAL_VIDEO_BYTES||bytes.subarray(4,8).toString()!=='ftyp')throw new VideoStateError('VIDEO_MEDIA_INPUT_INVALID');
  const name=`desvio-video-render-${randomUUID()}`,inputHash=digest(bytes);
  try{
   const value:any=await new Promise((resolve,reject)=>{
    const child=spawn('docker',['run','--rm','-i','--name',name,'--label','desvio.purpose=video-render-sandbox','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','2g','--memory-swap','2g','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=256m',this.image!],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
    const chunks:Buffer[]=[];let total=0,done=false;
    const finish=(error?:Error,result?:unknown)=>{if(done)return;done=true;clearTimeout(timer);child.stdin.destroy();if(error){child.kill('SIGKILL');reject(error);}else resolve(result);};
    const timer=setTimeout(()=>finish(new VideoStateError('VIDEO_RENDER_TIMEOUT')),190000);
    child.on('error',()=>finish(new VideoStateError('VIDEO_RENDERER_UNAVAILABLE')));child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>94*1024*1024)return finish(new VideoStateError('VIDEO_RENDER_OUTPUT_LIMIT'));chunks.push(chunk);});
    child.on('close',code=>{try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(v.type==='error')return finish(new VideoStateError(typeof v.code==='string'&&/^VIDEO_[A-Z_]{1,80}$/.test(v.code)?v.code:'VIDEO_RENDER_FAILED'));if(code!==0)return finish(new VideoStateError('VIDEO_RENDER_FAILED'));finish(undefined,v);}catch{finish(new VideoStateError('VIDEO_RENDER_FAILED'));}});
    child.stdin.end(JSON.stringify({version:1,input_base64:bytes.toString('base64'),input_sha256:inputHash,expected_duration_seconds:duration,overlays}));
   });
   const m=value?.metadata;
   if(value?.type!=='result'||value.version!==VIDEO_RENDER_VERSION||value.input_sha256!==inputHash||JSON.stringify(value.overlays)!==JSON.stringify(overlays)||!m||m.codec!=='h264'||typeof m.audio!=='boolean'||![m.width,m.height,m.duration_ms].every(Number.isSafeInteger)||m.width<64||m.height<64||Math.max(m.width,m.height)>1920||Math.min(m.width,m.height)>1080||m.width%2||m.height%2||Math.abs(m.duration_ms-duration*1000)>250)throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   const video=decode(value.video,'video/mp4',MAX_CANONICAL_VIDEO_BYTES),poster=decode(value.poster,'image/png',2*1024*1024);
   if(video.subarray(4,8).toString()!=='ftyp')throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   const pm=await sharp(poster,{limitInputPixels:640*640}).metadata();
   if(pm.format!=='png'||!pm.width||!pm.height||pm.width>640||pm.height>640||Math.abs(pm.width*m.height-pm.height*m.width)>Math.max(m.width,m.height))throw new VideoStateError('VIDEO_RENDER_OUTPUT_INVALID');
   await sharp(poster,{limitInputPixels:640*640}).raw().toBuffer();
   return {video,poster,metadata:m,manifest:{version:value.version,image:this.image,input_sha256:inputHash,video_sha256:value.video.sha256,poster_sha256:value.poster.sha256,metadata:{codec:m.codec,audio:m.audio,width:m.width,height:m.height,duration_ms:m.duration_ms},overlays}};
  }finally{await promisify(execFile)('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});}
 }
}
