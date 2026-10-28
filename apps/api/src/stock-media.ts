import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {PutObjectCommand} from '@aws-sdk/client-s3';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {canonicalJSON,hash} from './brand-brain.js';
import {validateDesign} from './creative-design.js';
import {digest} from './object-store.js';
import {Businesses} from './businesses.js';
import {Assets} from './assets.js';
import {StockProvider} from './stock-provider.js';
import {object,uuid} from './workspaces.js';
export class StockMedia{
 constructor(readonly businesses:Businesses,readonly assets:Assets,readonly provider:StockProvider){}
 private async scope<T>(user:string,id:string,write:boolean,fn:(db:any,b:any)=>Promise<T>){const b=await this.businesses.resolve(user,id);return this.businesses.database.transaction(user,b.organization_id,write,db=>fn(db,b),id);}
 async capabilities(user:string,id:string){return this.scope(user,id,false,async()=>({search_available:this.provider.configured}));}
 async search(user:string,id:string,query:unknown){const v=object(query,['query','page']);await this.scope(user,id,false,async()=>true);return this.provider.search(v.query,v.page??1);}
 async preview(user:string,id:string,photo:string){await this.scope(user,id,false,async()=>true);return this.provider.image(await this.provider.photo(photo),true);}
 async status(user:string,id:string,key:string){return this.scope(user,id,false,async(db,b)=>{const row=(await db.query(`SELECT s.asset_id,s.photo_id,s.attribution,a.state,a.error_code,u.id AS visual_id FROM app.stock_imports s JOIN app.assets a ON a.id=s.asset_id LEFT JOIN app.uploaded_visuals u ON u.asset_id=a.id WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.request_key=$3`,[b.organization_id,id,key])).rows[0];if(!row)throw new NotFoundException('Stock import not found');return row;});}
 async import(user:string,id:string,input:unknown,key:unknown){
  const v=object(input,['photo_id']);if(!Number.isSafeInteger(v.photo_id)||Number(v.photo_id)<1)throw new BadRequestException('Choose a stock photo');
  if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,100}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
  const b=await this.scope(user,id,true,async(_db,b)=>b);
  let prior:any;try{prior=await this.status(user,id,key);}catch(e){if(!(e instanceof NotFoundException))throw e;}
  if(prior&&Number(prior.photo_id)!==v.photo_id)throw new ConflictException('This request key belongs to another photo');
  if(prior&&prior.state!=='awaiting_upload')return prior;
  const photo=await this.provider.photo(v.photo_id),image=await this.provider.image(photo),sha=createHash('sha256').update(image.bytes).digest('hex');
  const filename=`pexels-${photo.id}.${image.type==='image/png'?'png':image.type==='image/webp'?'webp':'jpg'}`;
  const reservation=await this.assets.reserve(user,b.organization_id,id,{filename,contentType:image.type,bytes:image.bytes.length,sha256:sha},`stock:${key}`);
  const asset=await this.scope(user,id,true,async(db,b)=>{
   await db.query(`INSERT INTO app.stock_imports(organization_id,brand_id,asset_id,request_key,provider,photo_id,attribution,created_by) VALUES($1,$2,$3,$4,'pexels',$5,$6,$7) ON CONFLICT DO NOTHING`,[b.organization_id,id,reservation.id,key,photo.id,JSON.stringify({photographer:photo.photographer,url:photo.url,photographer_url:photo.photographer_url,alt:photo.alt}),user]);
   const row=(await db.query('SELECT a.id,a.quarantine_key,a.state,s.photo_id FROM app.stock_imports s JOIN app.assets a ON a.id=s.asset_id WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.request_key=$3',[b.organization_id,id,key])).rows[0];
   if(!row||row.id!==reservation.id||Number(row.photo_id)!==photo.id)throw new ConflictException('This stock selection changed');return row;
  });
  if(asset.state==='awaiting_upload')await this.assets.store.client.send(new PutObjectCommand({Bucket:this.assets.store.config.bucket,Key:asset.quarantine_key,Body:image.bytes,ContentType:image.type,ContentLength:image.bytes.length}),{abortSignal:AbortSignal.timeout(15000)});
  await this.assets.complete(user,b.organization_id,id,reservation.id);
  return this.status(user,id,key);
 }
 async replace(user:string,id:string,projectId:string,input:unknown){
  projectId=uuid(projectId);const v=object(input,['parent_id','reference_id']),parent=uuid(String(v.parent_id)),reference=uuid(String(v.reference_id));
  return this.scope(user,id,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${id.toLowerCase()}`]);
   const p=(await db.query(`SELECT v.*,p.latest_version_id,p.archived_at,m.width,m.height FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id JOIN app.creative_media m ON m.id=v.media_id WHERE v.organization_id=$1 AND v.brand_id=$2 AND v.project_id=$3 AND v.id=$4`,[b.organization_id,id,projectId,parent])).rows[0];
   if(!p)throw new NotFoundException('Creative not found');if(p.archived_at)throw new ConflictException('Restore this creative before replacing its photo');
   const source=(await db.query(`SELECT u.* FROM app.brand_references r JOIN app.uploaded_visuals u ON u.id=r.uploaded_visual_id WHERE r.organization_id=$1 AND r.brand_id=$2 AND r.id=$3 AND r.revoked_at IS NULL AND EXISTS(SELECT 1 FROM app.stock_imports s WHERE s.organization_id=$1 AND s.brand_id=$2 AND s.asset_id=u.asset_id)`,[b.organization_id,id,reference])).rows[0];
   if(!source)throw new NotFoundException('Approved stock photo not found');
   const sourceBytes=await this.assets.store.read(source.object_key,6*1024*1024);if(digest(sourceBytes)!==source.sha256||sourceBytes.length!==source.bytes)throw new ConflictException('This photo could not be verified');
   const bytes=await sharp(sourceBytes,{limitInputPixels:3072*3072}).resize(p.width,p.height,{fit:'cover',position:'centre'}).png().toBuffer(),sha=digest(bytes);
   let media=(await db.query('SELECT id FROM app.creative_media WHERE organization_id=$1 AND brand_id=$2 AND source_uploaded_visual_id=$3 AND width=$4 AND height=$5 AND sha256=$6',[b.organization_id,id,source.id,p.width,p.height,sha])).rows[0];
   const mediaId=media?.id??randomUUID(),design=validateDesign({...p.design,background_media_id:mediaId},mediaId,p.width,p.height),versionHash=hash(canonicalJSON({design,caption:p.caption,brain_id:p.brain_id}));
   const replay=(await db.query('SELECT id FROM app.creative_versions WHERE project_id=$1 AND parent_id=$2 AND sha256=$3 AND created_by=$4',[projectId,parent,versionHash,user])).rows[0];if(replay)return replay;
   if(p.latest_version_id!==parent)throw new ConflictException('Open the latest saved version before replacing its photo');
   if((await db.query('SELECT count(*)::int AS n FROM app.creative_versions WHERE project_id=$1',[projectId])).rows[0].n>=100)throw new ConflictException('Creative version limit reached');
   if(!media){
    if(Number((await db.query('SELECT COALESCE(sum(bytes),0) AS bytes FROM app.creative_media WHERE organization_id=$1 AND brand_id=$2',[b.organization_id,id])).rows[0].bytes)+bytes.length>512*1024*1024)throw new ConflictException('Creative storage limit reached');
    const objectKey=`creative-stock/${b.organization_id}/${id}/${source.id}/${p.width}x${p.height}/${sha}`;
    await this.assets.store.persist(objectKey,bytes,'image/png',sha);
    await db.query('INSERT INTO app.creative_media(id,organization_id,brand_id,source_uploaded_visual_id,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[mediaId,b.organization_id,id,source.id,objectKey,sha,bytes.length,p.width,p.height]);
   }
   const version=randomUUID();await db.query('INSERT INTO app.creative_versions(id,organization_id,brand_id,project_id,parent_id,brain_id,media_id,design,caption,skill_manifest,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[version,b.organization_id,id,projectId,parent,p.brain_id,mediaId,JSON.stringify(design),p.caption,JSON.stringify(p.skill_manifest),versionHash,user]);
   await db.query('UPDATE app.creative_projects SET latest_version_id=$2 WHERE id=$1',[projectId,version]);
   await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'creative.stock_photo_replaced',$4)",[b.organization_id,id,user,version]);return {id:version};
  });
 }

}
