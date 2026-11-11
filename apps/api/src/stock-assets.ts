import {AssetJobs,type JobScope} from './jobs.js';
import {VecteezyClient,StockError} from './vecteezy-client.js';
import {SafeWeb} from './safe-web.js';
import {normalizeProductPhoto} from './uploaded-visuals.js';
import {digest} from './object-store.js';

/** No vendor URL, title or license metadata is exposed to customer response objects.
 * Persist a reservation BEFORE the billable GET. An interrupted attempt is never
 * replayed automatically, including a crash between purchase and private copy.
 */
export class StockAssets {
 constructor(readonly jobs:AssetJobs,readonly vendor:VecteezyClient,readonly web=new SafeWeb()){}
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
