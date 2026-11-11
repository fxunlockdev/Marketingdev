import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {DEFAULT_PREVIEW_WIDTH,MAX_PREVIEW_BYTES,PREVIEW_WIDTHS,previewKey,type PreviewWidth} from './media-variants.js';

export type ImagePreview={bytes:Buffer;sha256:string};
/** Private object storage for derived previews. `read` resolves null when the object does not exist. */
export type PreviewPersistence={read(key:string):Promise<Buffer|null>;write(key:string,bytes:Buffer):Promise<void>};
export type PreviewStats={memory:number;storage:number;generated:number;persistFailures:number};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const isWebp=(bytes:Buffer)=>bytes.length>12&&bytes.length<=MAX_PREVIEW_BYTES&&bytes.toString('latin1',0,4)==='RIFF'&&bytes.toString('latin1',8,12)==='WEBP';
const storedKey=(key:string,sourceHash:string,width:PreviewWidth):string|null=>{try{return previewKey(key,sourceHash,width);}catch{return null;}};

/** One display variant: WebP at exactly `width` pixels wide (never enlarged), aspect preserved. */
export async function renderPreview(original:Buffer,width:PreviewWidth):Promise<Buffer>{
 if(!PREVIEW_WIDTHS.includes(width))throw new RangeError('Invalid preview width');
 const bytes=await sharp(original,{limitInputPixels:24_000_000,animated:false}).rotate().resize({width,withoutEnlargement:true}).webp({quality:82,effort:width>640?3:2}).toBuffer();
 if(bytes.length>MAX_PREVIEW_BYTES)throw new Error('Preview exceeds size limit');
 return bytes;
}

/** Derived display images only. Call after tenant authorization on every request.
 * Originals remain untouched. Lookup order: bounded memory, private storage, then one
 * verified transformation whose result is stored so no process has to repeat it.
 * Bounded memory and concurrency avoid replacing network latency with unbounded image processing.
 */
export class ImagePreviews {
 readonly stats:PreviewStats={memory:0,storage:0,generated:0,persistFailures:0};
 private readonly cache=new Map<string,{value:ImagePreview;expires:number}>();
 private readonly pending=new Map<string,Promise<ImagePreview>>();
 private readonly waiting:Array<()=>void>=[];
 private active=0;
 private size=0;
 private persistence?:PreviewPersistence;
 private onPersistError:(error:unknown)=>void=()=>{};
 constructor(private readonly read:(key:string)=>Promise<Buffer>,private readonly maxBytes=16*1024*1024,private readonly now=Date.now){}
 /** Attach private storage at the composition root. Storage failures are reported here and never fail a request. */
 persistTo(persistence:PreviewPersistence,onError:(error:unknown)=>void=()=>{}):void{this.persistence=persistence;this.onPersistError=onError;}
 async get(key:string,sourceHash:string,width:PreviewWidth=DEFAULT_PREVIEW_WIDTH):Promise<ImagePreview>{
  if(!/^[a-f0-9]{64}$/.test(sourceHash))throw new Error('Invalid preview source');
  if(!PREVIEW_WIDTHS.includes(width))throw new RangeError('Invalid preview width');
  const cacheKey=`${key}:${sourceHash}:${width}`;
  const existing=this.cache.get(cacheKey);
  if(existing){this.cache.delete(cacheKey);if(existing.expires>this.now()){this.cache.set(cacheKey,existing);this.stats.memory++;return existing.value;}this.size-=existing.value.bytes.length;}
  const pending=this.pending.get(cacheKey);if(pending)return pending;
  if(this.pending.size>=32)throw new Error('Preview capacity reached');
  const task=this.load(key,sourceHash,width).then(value=>{
   while(this.cache.size&&(this.size+value.bytes.length>this.maxBytes||this.cache.size>=256)){
    const first=this.cache.keys().next().value!;this.size-=this.cache.get(first)!.value.bytes.length;this.cache.delete(first);
   }
   if(value.bytes.length<=this.maxBytes){this.cache.set(cacheKey,{value,expires:this.now()+15*60*1000});this.size+=value.bytes.length;}
   return value;
  });
  this.pending.set(cacheKey,task);
  try{return await task;}finally{this.pending.delete(cacheKey);}
 }
 /** For the process that creates an original: store every width while the bytes are already in memory,
  * so the first viewer never waits for a transformation. Returns the widths written. */
 async pregenerate(key:string,sourceHash:string,original:Buffer,widths:readonly PreviewWidth[]=PREVIEW_WIDTHS):Promise<PreviewWidth[]>{
  if(digest(original)!==sourceHash)throw new Error('Preview source integrity failed');
  const written:PreviewWidth[]=[];
  for(const width of widths){
   const target=storedKey(key,sourceHash,width);
   if(!target||!this.persistence||await this.stored(target))continue;
   const bytes=await this.limited(()=>renderPreview(original,width));
   await this.persistence.write(target,bytes);written.push(width);
  }
  return written;
 }
 private async load(key:string,sourceHash:string,width:PreviewWidth):Promise<ImagePreview>{
  const target=this.persistence?storedKey(key,sourceHash,width):null;
  if(target){const stored=await this.stored(target);if(stored){this.stats.storage++;return {bytes:stored,sha256:digest(stored)};}}
  const value=await this.limited(()=>this.create(key,sourceHash,width));this.stats.generated++;
  if(target)await this.persistence!.write(target,value.bytes).catch(error=>this.failed(error));
  return value;
 }
 private async stored(target:string):Promise<Buffer|null>{
  try{
   const bytes=await this.persistence!.read(target);
   if(bytes&&!isWebp(bytes))throw new Error('Stored preview is not a WebP image');
   return bytes;
  }catch(error){this.failed(error);return null;}
 }
 private failed(error:unknown):void{this.stats.persistFailures++;this.onPersistError(error);}
 private async limited<T>(work:()=>Promise<T>):Promise<T>{
  if(this.active>=2)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;
  try{return await work();}finally{const next=this.waiting.shift();if(next)next();else this.active--;}
 }
 private async create(key:string,sourceHash:string,width:PreviewWidth):Promise<ImagePreview>{
  const original=await this.read(key);
  if(digest(original)!==sourceHash)throw new Error('Preview source integrity failed');
  const bytes=await renderPreview(original,width);
  return {bytes,sha256:digest(bytes)};
 }
 clear(){this.cache.clear();this.size=0;}
}
