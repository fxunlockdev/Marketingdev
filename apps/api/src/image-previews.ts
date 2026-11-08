import sharp from 'sharp';
import {createHash} from 'node:crypto';

export type ImagePreview={bytes:Buffer;sha256:string};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** Derived display images only. Call after tenant authorization on every request.
 * Originals remain untouched. Bounded memory and concurrency avoid replacing
 * network latency with unbounded image processing or persistent private caches.
 */
export class ImagePreviews {
 private readonly cache=new Map<string,{value:ImagePreview;expires:number}>();
 private readonly pending=new Map<string,Promise<ImagePreview>>();
 private readonly waiting:Array<()=>void>=[];
 private active=0;
 private size=0;
 constructor(private readonly read:(key:string)=>Promise<Buffer>,private readonly maxBytes=16*1024*1024,private readonly now=Date.now){}
 async get(key:string,sourceHash:string):Promise<ImagePreview>{
  if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Invalid preview source');
  const cacheKey=key+':'+sourceHash;
  const existing=this.cache.get(cacheKey);
  if(existing){this.cache.delete(cacheKey);if(existing.expires>this.now()){this.cache.set(cacheKey,existing);return existing.value;}this.size-=existing.value.bytes.length;}
  const pending=this.pending.get(cacheKey);if(pending)return pending;
  if(this.pending.size>=32)throw new Error('Preview capacity reached');
  const task=this.create(key,sourceHash).then(value=>{
   while(this.cache.size&&(this.size+value.bytes.length>this.maxBytes||this.cache.size>=256)){
    const first=this.cache.keys().next().value!;this.size-=this.cache.get(first)!.value.bytes.length;this.cache.delete(first);
   }
   if(value.bytes.length<=this.maxBytes){this.cache.set(cacheKey,{value,expires:this.now()+15*60*1000});this.size+=value.bytes.length;}
   return value;
  });
  this.pending.set(cacheKey,task);
  try{return await task;}finally{this.pending.delete(cacheKey);}
 }
 private async create(key:string,sourceHash:string):Promise<ImagePreview>{
  if(this.active>=2)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;
  try{
   const original=await this.read(key);
   if(digest(original)!==sourceHash)throw new Error('Preview source integrity failed');
   const bytes=await sharp(original,{limitInputPixels:24_000_000,animated:false}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:82,effort:2}).toBuffer();
   if(bytes.length>1024*1024)throw new Error('Preview exceeds size limit');
   return {bytes,sha256:digest(bytes)};
  }finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
 clear(){this.cache.clear();this.size=0;}
}
