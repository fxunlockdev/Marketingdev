import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {digest} from './object-store.js';
import {validateDesign,type Design} from './creative-design.js';
import {CreativeError} from './creative-contracts.js';
export class StaticRenderer {
 constructor(readonly image?:string){}
 get configured(){return !!this.image&&/^sha256:[a-f0-9]{64}$/.test(this.image);}
 async render(design:Design,bytes:Buffer){
  if(!this.configured)throw new CreativeError('EXPORT_RENDERER_NOT_CONFIGURED');
  validateDesign(design,design.background_media_id,design.width,design.height);
  if(bytes.length>20*1024*1024)throw new CreativeError('EXPORT_INPUT_LIMIT');
  const meta=await sharp(bytes,{limitInputPixels:1536*1536}).metadata();
  if(meta.format!=='png'||meta.width!==design.width||meta.height!==design.height)throw new CreativeError('EXPORT_IMAGE_INVALID');
  const name=`desvio-render-${randomUUID()}`;
  try{
   const value:any=await new Promise((resolve,reject)=>{
    const child=spawn('docker',['run','--rm','-i','--name',name,'--label','desvio.purpose=render-sandbox','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','48','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=32m',this.image!],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
    const chunks:Buffer[]=[];let total=0,settled=false;
    const finish=(e?:Error,result?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);child.stdin.destroy();if(e){child.kill('SIGKILL');reject(e);}else resolve(result);};
    const timer=setTimeout(()=>finish(new CreativeError('EXPORT_RENDER_TIMEOUT')),45000);
    child.on('error',()=>finish(new CreativeError('EXPORT_RENDERER_UNAVAILABLE')));child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',(b:Buffer)=>{total+=b.length;if(total>29_000_000)return finish(new CreativeError('EXPORT_OUTPUT_LIMIT'));chunks.push(b);});
    child.on('close',()=>{try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(v.error)return finish(new CreativeError(/^EXPORT_[A-Z_]+$/.test(v.error)?v.error:'EXPORT_RENDER_FAILED'));finish(undefined,v);}catch{finish(new CreativeError('EXPORT_RENDER_FAILED'));}});
    child.stdin.end(JSON.stringify({design,png:bytes.toString('base64'),media_sha256:digest(bytes)}));
   });
   if(typeof value.png!=='string'||!value.manifest||value.manifest.fabric!=='7.4.0'||value.manifest.canvas!=='3.2.0'||!Array.isArray(value.warnings)||value.warnings.length>10||value.warnings.some((s:any)=>typeof s!=='string'||s.length>300))throw new CreativeError('EXPORT_OUTPUT_INVALID');
   const output=Buffer.from(value.png,'base64');const meta=await sharp(output,{limitInputPixels:1536*1536}).metadata();
   if(output.length>20*1024*1024||digest(output)!==value.sha256||meta.format!=='png'||meta.width!==design.width||meta.height!==design.height||value.width!==design.width||value.height!==design.height)throw new CreativeError('EXPORT_OUTPUT_INVALID');
   return {bytes:output,sha256:value.sha256,width:meta.width,height:meta.height,manifest:{...value.manifest,image:this.image,warnings:value.warnings}};
  }finally{await promisify(execFile)('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});}
 }
}
