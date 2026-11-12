import sharp from 'sharp';
import {stockQueryRequest,stockSelectionRequest,stockVisionRequest,stockQueries,stockSelection,stockVisualChoice,stockSkipReason,mergeCandidates,type StockChoice,type StockContext,type StockPreview,type StockUse} from './stock-planning.js';
import {CreativeError,type CreativeInput,type PlannerRequest,type PlannerResponse} from './creative-contracts.js';
import {AssetJobs,type JobScope} from './jobs.js';
import {VecteezyClient,StockError,type StockPhoto} from './vecteezy-client.js';
import {SafeWeb} from './safe-web.js';
import {normalizeProductPhoto} from './uploaded-visuals.js';
import {digest} from './object-store.js';

export type StockReference={photo:Buffer;use:StockUse};
type Planner=(request:PlannerRequest)=>Promise<PlannerResponse>;
type Decision={outcome:'selected'|'reused'|'skipped';skipReason?:string;resourceId?:number;use?:StockUse;sourceJobId?:string};
type SelectionRow={candidates:StockPhoto[];outcome:Decision['outcome']|null;selected_resource_id:string|number|null;use_as:StockUse|null;source_job_id:string|null};
const PREVIEW_FETCH_BYTES=1536*1024,PREVIEW_EDGE=256,PREVIEW_TOTAL_BYTES=200*1024,PREVIEW_PARALLEL=6,PREVIEW_TIMEOUT_MS=5000;
/** Hamming distance (of 64) at or below which an output is a near copy of its stock source. */
export const STOCK_TOO_CLOSE_DISTANCE=6;
const reasonCode=(code:string)=>/^[A-Z0-9_]{3,64}$/.test(code)?code:'STOCK_FAILED';

/** A stock planning call that cannot be made skips stock. Only revoked access still stops the job. */
function optional(plan:Planner):Planner{
 return async request=>{
  try{return await plan(request);}
  catch(error){if(error instanceof CreativeError&&error.code!=='CREATIVE_ACCESS_REVOKED')throw new StockError(error.code);throw error;}
 };
}
async function differenceHash(image:Buffer):Promise<bigint>{
 const pixels=await sharp(image,{limitInputPixels:64_000_000}).greyscale().resize(9,8,{fit:'fill'}).raw().toBuffer();
 let bits=0n;
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits=bits<<1n|(pixels[y*9+x]<pixels[y*9+x+1]?1n:0n);
 return bits;
}
/** Perceptual distance between a stock photo and a finished creative: 0 identical, 64 unrelated.
 * Both are compared as whole frames, so a heavy crop or a flat, featureless image is not detected.
 */
export async function stockSourceDistance(stock:Buffer,output:Buffer):Promise<number>{
 const [a,b]=await Promise.all([differenceHash(stock),differenceHash(output)]);
 let difference=a^b,distance=0;
 for(;difference;difference>>=1n)distance+=Number(difference&1n);
 return distance;
}
/** For the quality stage: true when the finished creative is little more than the stock photo itself. */
export async function tooCloseToStock(stock:Buffer,output:Buffer,threshold=STOCK_TOO_CLOSE_DISTANCE):Promise<{distance:number;tooClose:boolean}>{
 const distance=await stockSourceDistance(stock,output);
 return {distance,tooClose:distance<=threshold};
}

/** No vendor URL, title or license metadata is exposed to customer response objects.
 * Persist a reservation BEFORE the billable GET. An interrupted attempt is never
 * replayed automatically, including a crash between purchase and private copy.
 * Stock is optional: reference() returns null, with the reason recorded, instead of failing.
 */
export class StockAssets {
 constructor(readonly jobs:AssetJobs,readonly vendor:VecteezyClient,readonly web=new SafeWeb()){}
 /** The photo for this creative and how to use it, or null when the creative goes ahead without stock. */
 async reference(scope:JobScope,input:CreativeInput,context:StockContext,plan:Planner):Promise<StockReference|null>{
  try{return await this.resolve(scope,input,context,optional(plan));}
  catch(error){
   if(!(error instanceof StockError))throw error;
   await this.record(scope,{outcome:'skipped',skipReason:reasonCode(error.code)});
   return null;
  }
 }
 private async resolve(scope:JobScope,input:CreativeInput,context:StockContext,plan:Planner):Promise<StockReference|null>{
  const saved=await this.selection(scope);
  // A recorded decision is final, so a replay sends the image model the same references.
  if(saved?.outcome==='skipped')return null;
  if(saved?.outcome==='selected'&&saved.use_as)return {photo:await this.acquire(scope,Number(saved.selected_resource_id)),use:saved.use_as};
  const skip=stockSkipReason(context);
  if(skip)throw new StockError(skip);
  await this.authorize(scope);
  if(saved?.outcome==='reused'||(context.carouselPosition??0)>0)return this.shared(scope);
  const candidates=saved?.candidates.length?saved.candidates:await this.search(scope,input,context,plan);
  const choice=await this.choose(context,candidates,plan);
  await this.record(scope,{outcome:'selected',resourceId:choice.id,use:choice.use});
  return {photo:await this.acquire(scope,choice.id),use:choice.use};
 }
 private selection(scope:JobScope):Promise<SelectionRow|undefined>{
  return this.jobs.transaction(scope,async db=>(await db.query('SELECT * FROM app.stock_selections WHERE job_id=$1',[scope.jobId])).rows[0]);
 }
 private async record(scope:JobScope,decision:Decision):Promise<void>{
  await this.jobs.transaction(scope,async db=>{
   await db.query('INSERT INTO app.stock_selections(job_id,organization_id,brand_id,candidates,outcome,skip_reason,selected_resource_id,use_as,source_job_id) VALUES($1,$2,$3,\'[]\',$4,$5,$6,$7,$8) ON CONFLICT(job_id) DO UPDATE SET outcome=EXCLUDED.outcome,skip_reason=EXCLUDED.skip_reason,selected_resource_id=COALESCE(EXCLUDED.selected_resource_id,app.stock_selections.selected_resource_id),use_as=COALESCE(EXCLUDED.use_as,app.stock_selections.use_as),source_job_id=EXCLUDED.source_job_id,updated_at=now()',
    [scope.jobId,scope.organizationId,scope.brandId,decision.outcome,decision.skipReason??null,decision.resourceId??null,decision.use??null,decision.sourceJobId??null]);
  });
 }
 /** Up to three searches merged into one candidate list, saved so a resumed job ranks the same set. */
 private async search(scope:JobScope,input:CreativeInput,context:StockContext,plan:Planner):Promise<StockPhoto[]>{
  const queries=stockQueries(await plan(stockQueryRequest(input,context.imagePrompt,context.orientation)));
  const lists:StockPhoto[][]=[];let failure:StockError|undefined;
  for(const query of queries){
   try{lists.push(await this.vendor.search(query,context.orientation));}
   // Keep what earlier queries found; do not keep calling a vendor that just refused.
   catch(error){if(!(error instanceof StockError))throw error;failure=error;break;}
  }
  const found=mergeCandidates(lists);
  if(!found.length)throw failure??new StockError('STOCK_NO_RESULTS');
  // Ephemeral vendor URLs stay out of persistent records and model prompts.
  const snapshot=found.map(({id,title,aiGenerated})=>({id,title,aiGenerated,previewURL:null}));
  const stored:StockPhoto[]=await this.jobs.transaction(scope,async(db,j)=>{
   if(!await this.jobs.permitted(db,j))throw new StockError('STOCK_ACCESS_REVOKED');
   await db.query('INSERT INTO app.stock_selections(job_id,organization_id,brand_id,query,queries,candidates) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(job_id) DO NOTHING',[scope.jobId,scope.organizationId,scope.brandId,queries[0],JSON.stringify(queries),JSON.stringify(snapshot)]);
   return (await db.query('SELECT * FROM app.stock_selections WHERE job_id=$1',[scope.jobId])).rows[0].candidates;
  });
  // Preview addresses live only in memory, for this attempt's ranking.
  const live=new Map(found.map(photo=>[photo.id,photo.previewURL]));
  return stored.map(photo=>({...photo,previewURL:live.get(photo.id)??null}));
 }
 /** Rank by looking at the previews when the model can see them; otherwise by title. */
 private async choose(context:StockContext,candidates:StockPhoto[],plan:Planner):Promise<StockChoice>{
  const previews=context.vision?await this.previews(candidates):[];
  if(previews.length)return stockVisualChoice(await plan(stockVisionRequest(context,candidates,previews)),candidates);
  return {id:stockSelection(await plan(stockSelectionRequest(context.imagePrompt,candidates)),candidates),use:'inspiration'};
 }
 /** Small re-encoded copies of the vendor previews, held in memory only. */
 private async previews(candidates:StockPhoto[]):Promise<StockPreview[]>{
  const fetched:(StockPreview|null)[]=[];
  for(let i=0;i<candidates.length;i+=PREVIEW_PARALLEL)fetched.push(...await Promise.all(candidates.slice(i,i+PREVIEW_PARALLEL).map(photo=>this.preview(photo))));
  const kept:StockPreview[]=[];let total=0;
  for(const preview of fetched){
   if(!preview)continue;
   const bytes=Buffer.byteLength(preview.data,'base64');
   if(total+bytes>PREVIEW_TOTAL_BYTES)break;
   total+=bytes;kept.push(preview);
  }
  return kept;
 }
 private async preview(photo:StockPhoto):Promise<StockPreview|null>{
  if(!photo.previewURL)return null;
  try{
   const url=new URL(photo.previewURL);if(url.protocol!=='https:')return null;
   // SafeWeb pins public DNS and follows no redirects.
   const response=await this.web.fetch(url,PREVIEW_FETCH_BYTES,'image/jpeg,image/png,image/webp',PREVIEW_TIMEOUT_MS);
   if(response.status!==200)return null;
   // Re-encoding drops metadata and anything that is not a picture.
   const data=await sharp(response.bytes,{limitInputPixels:24_000_000}).rotate().resize({width:PREVIEW_EDGE,height:PREVIEW_EDGE,fit:'inside',withoutEnlargement:true}).jpeg({quality:60}).toBuffer();
   return {id:photo.id,mediaType:'image/jpeg',data:data.toString('base64')};
  }catch{
   // A preview that cannot be fetched or decoded is simply not shown; ranking falls back to its title.
   return null;
  }
 }
 /** A later carousel slide uses the first slide's photo. It never searches or buys its own. */
 private async shared(scope:JobScope):Promise<StockReference>{
  const source=await this.jobs.transaction(scope,async db=>(await db.query("SELECT a.job_id,a.resource_id,a.object_key,a.sha256,a.bytes,s.use_as FROM app.carousel_children me JOIN app.carousel_children first ON first.parent_job_id=me.parent_job_id AND first.position=0 JOIN app.stock_acquisitions a ON a.job_id=first.generation_job_id AND a.status='ready' JOIN app.stock_selections s ON s.job_id=a.job_id AND s.outcome='selected' WHERE me.generation_job_id=$1 AND me.position>0",[scope.jobId])).rows[0]);
  if(!source)throw new StockError('STOCK_SKIPPED_CAROUSEL_SLIDE');
  const photo=await this.jobs.store.read(source.object_key,6*1024*1024);
  if(photo.length!==source.bytes||digest(photo)!==source.sha256)throw new StockError('STOCK_INTEGRITY_FAILED');
  await this.record(scope,{outcome:'reused',resourceId:Number(source.resource_id),use:source.use_as,sourceJobId:source.job_id});
  return {photo,use:source.use_as};
 }
 async authorize(scope:JobScope){
  if(!this.vendor.configured)throw new StockError('STOCK_NOT_CONFIGURED');
  await this.jobs.transaction(scope,async(db,j)=>{
   if(!await this.jobs.permitted(db,j))throw new StockError('STOCK_ACCESS_REVOKED');
   if(!(await db.query('SELECT * FROM app.stock_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND ai_use_authorized AND expires_at>now()',[scope.organizationId,scope.brandId])).rows.length)throw new StockError('STOCK_GRANT_REQUIRED');
  });
 }
 async acquire(scope:JobScope,resourceId:number):Promise<Buffer>{
  if(!Number.isSafeInteger(resourceId)||resourceId<=0)throw new StockError('STOCK_RESOURCE_INVALID');
  if(!this.vendor.configured)throw new StockError('STOCK_NOT_CONFIGURED');
  const saved=await this.jobs.transaction(scope,async(db,j)=>{
   if(!await this.jobs.permitted(db,j))throw new StockError('STOCK_ACCESS_REVOKED');
   const grant=(await db.query('SELECT * FROM app.stock_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND ai_use_authorized AND expires_at>now()',[scope.organizationId,scope.brandId])).rows[0];
   if(!grant)throw new StockError('STOCK_GRANT_REQUIRED');
   const old=(await db.query('SELECT * FROM app.stock_acquisitions WHERE job_id=$1',[scope.jobId])).rows[0];
   if(old){
    if(Number(old.resource_id)!==resourceId)throw new StockError('STOCK_SELECTION_CHANGED');
    if(old.status==='ready')return old;
    throw new StockError(old.status==='rejected'?'STOCK_ASSET_REJECTED':'STOCK_DOWNLOAD_UNKNOWN');
   }
   // AssetJobs holds the organization membership lock, serializing the daily cap.
   const count=Number((await db.query("SELECT count(*) AS n FROM app.stock_acquisitions WHERE organization_id=$1 AND brand_id=$2 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[scope.organizationId,scope.brandId])).rows[0].n);
   if(count>=grant.max_daily_downloads)throw new StockError('STOCK_DAILY_LIMIT');
   await db.query("INSERT INTO app.stock_acquisitions(job_id,organization_id,brand_id,resource_id,status) VALUES($1,$2,$3,$4,'acquiring')",[scope.jobId,scope.organizationId,scope.brandId,resourceId]);
   return null;
  });
  if(saved){const bytes=await this.jobs.store.read(saved.object_key,6*1024*1024);if(bytes.length!==saved.bytes||digest(bytes)!==saved.sha256)throw new StockError('STOCK_INTEGRITY_FAILED');return bytes;}
  try{
   const download=await this.vendor.download(resourceId);
   await this.jobs.transaction(scope,async(db)=>{await db.query('UPDATE app.stock_acquisitions SET requires_attribution=$2,attribution_url=$3,updated_at=now() WHERE job_id=$1',[scope.jobId,download.requiresAttribution,download.attributionURL]);});
   // Current product requires no visible stock attribution. Never silently strip it.
   if(download.requiresAttribution)throw new StockError('STOCK_ATTRIBUTION_REQUIRED');
   const url=new URL(download.url);if(url.protocol!=='https:')throw new StockError('STOCK_MEDIA_INVALID');
   const response=await this.web.fetch(url,20*1024*1024,'image/jpeg',15000);
   if(response.status!==200)throw new StockError('STOCK_COPY_FAILED');
   // SafeWeb pins public DNS and follows no redirects; credentials never leave API.
   await this.jobs.scanner.scan(response.bytes);
   const photo=await normalizeProductPhoto(response.bytes);
   const key=`stock/${scope.organizationId}/${scope.brandId}/${scope.jobId}/${photo.sha256}`;
   await this.jobs.store.persist(key,photo.data,'image/jpeg',photo.sha256);
   await this.jobs.transaction(scope,async(db,j)=>{
    if(!await this.jobs.permitted(db,j))throw new StockError('STOCK_ACCESS_REVOKED');
    await db.query("UPDATE app.stock_acquisitions SET status='ready',object_key=$2,sha256=$3,bytes=$4,width=$5,height=$6,updated_at=now() WHERE job_id=$1 AND status='acquiring'",[scope.jobId,key,photo.sha256,photo.bytes,photo.width,photo.height]);
   });
   return photo.data;
  }catch(error){
   const code=error instanceof StockError?error.code:'STOCK_COPY_FAILED';
   await this.jobs.transaction(scope,async(db)=>{await db.query("UPDATE app.stock_acquisitions SET status=$2,error_code=$3,updated_at=now() WHERE job_id=$1 AND status='acquiring'",[scope.jobId,code==='STOCK_ATTRIBUTION_REQUIRED'?'rejected':'unknown',code]);});
   throw new StockError(code);
  }
 }
}
