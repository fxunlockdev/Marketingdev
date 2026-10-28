import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
export type StockPhoto={id:number;alt:string;photographer:string;url:string;photographer_url:string;preview:string;image:string};
const API='https://api.pexels.com/v1/';
export function stockURL(value:unknown,host:string){
 if(typeof value!=='string')throw new Error('Invalid stock URL');
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!==host||u.port||u.username||u.password||u.hash)throw new Error('Invalid stock URL');return u.href;
}
export function stockPhoto(v:any):StockPhoto{
 if(!Number.isSafeInteger(v?.id)||v.id<1||typeof v.photographer!=='string'||v.photographer.length>200||typeof v.alt!=='string'||v.alt.length>1000)throw new Error('Invalid stock photo');
 return {id:v.id,alt:v.alt,photographer:v.photographer,url:stockURL(v.url,'www.pexels.com'),photographer_url:stockURL(v.photographer_url,'www.pexels.com'),preview:stockURL(v.src?.medium,'images.pexels.com'),image:stockURL(v.src?.large2x,'images.pexels.com')};
}
async function bounded(response:Response,limit:number){
 if(!response.body||Number(response.headers.get('content-length'))>limit)throw new Error('Stock response too large');
 const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Stock response too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
/** Fixed provider origins only; never accepts a caller-supplied fetch URL. */
export class StockProvider{
 private cache=new Map<string,{expires:number;value:any}>();private hour=0;private requests=0;
 constructor(private readonly key?:string,private readonly transport:typeof fetch=fetch){}
 get configured(){return !!this.key;}
 private async json(path:string){
  if(!this.key)throw new ServiceUnavailableException('Stock search is currently unavailable.');
  const cached=this.cache.get(path);if(cached&&cached.expires>Date.now())return cached.value;
  const hour=Math.floor(Date.now()/3600000);if(hour!==this.hour){this.hour=hour;this.requests=0;}if(++this.requests>120)throw new ServiceUnavailableException('Stock search is busy. Please try again later.');
  try{const response=await this.transport(API+path,{headers:{Authorization:this.key},redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Provider unavailable');const value=JSON.parse((await bounded(response,2*1024*1024)).toString());if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value!);this.cache.set(path,{expires:Date.now()+3600000,value});return value;}catch{throw new ServiceUnavailableException('Stock photos could not load. Please try again later.');}
 }
 async search(query:unknown,page:unknown=1){
  if(typeof query!=='string'||!query.trim()||query.trim().length>100||/[\u0000-\u001f]/.test(query))throw new BadRequestException('Search with 1–100 characters');
  const p=Number(page);if(!Number.isSafeInteger(p)||p<1||p>100)throw new BadRequestException('Invalid stock page');
  const result=await this.json(`search?query=${encodeURIComponent(query.trim())}&page=${p}&per_page=18`);
  try{if(!Array.isArray(result.photos)||result.photos.length>18)throw new Error();const photos=result.photos.map(stockPhoto);for(const raw of result.photos){if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value!);this.cache.set(`photos/${raw.id}`,{expires:Date.now()+3600000,value:raw});}return {photos,page:p,has_more:Number(result.total_results)>p*18};}catch{throw new ServiceUnavailableException('Stock search returned an invalid result.');}
 }
 async photo(id:unknown){const n=Number(id);if(!Number.isSafeInteger(n)||n<1)throw new BadRequestException('Choose a stock photo');try{return stockPhoto(await this.json(`photos/${n}`));}catch(e){if(e instanceof ServiceUnavailableException)throw e;throw new ServiceUnavailableException('This stock photo is unavailable.');}}
 async image(photo:StockPhoto,preview=false){
  try{const url=stockURL(preview?photo.preview:photo.image,'images.pexels.com');const response=await this.transport(url,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const type=response.headers.get('content-type')?.split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type??''))throw new Error();const bytes=await bounded(response,preview?2*1024*1024:20*1024*1024);const valid=type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!valid)throw new Error();return {bytes,type:type!};}catch{throw new ServiceUnavailableException('This stock image could not download. Try another photo.');}
 }
}
