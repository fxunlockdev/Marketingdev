import {randomUUID} from 'node:crypto';
import {AssetJobs,type JobScope} from './jobs.js';
import {StaticRenderer} from './static-renderer.js';
import {CreativeError} from './creative-contracts.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {digest} from './object-store.js';
const terminal=new Set(['succeeded','failed','rejected','canceled']);
export class ExportJobs {
 constructor(readonly jobs:AssetJobs,readonly renderer:StaticRenderer){}
 finish(db:any,j:any,status:string,code:string|null=null){return db.query('UPDATE app.jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1',[j.id,status,code]).then(()=>status);}
 async run(scope:JobScope):Promise<string>{
  try{
   const input=await this.jobs.transaction(scope,async(db,j)=>{
    if(j.kind!=='creative.export')throw new Error('JOB_KIND_DENIED');if(terminal.has(j.status))return null;
    if(!await this.jobs.permitted(db,j)){await this.finish(db,j,'canceled','EXPORT_ACCESS_REVOKED');return null;}
    const r=(await db.query('SELECT * FROM app.creative_export_requests WHERE job_id=$1',[j.id])).rows[0];
    if(!this.renderer.configured)throw new CreativeError('EXPORT_RENDERER_NOT_CONFIGURED');if(r.renderer_image!==this.renderer.image)throw new CreativeError('EXPORT_RENDERER_CHANGED');
    const v=(await db.query('SELECT v.*,m.object_key,m.sha256 AS media_sha256,m.bytes AS media_bytes,m.width,m.height FROM app.creative_versions v JOIN app.creative_media m ON m.id=v.media_id WHERE v.id=$1',[r.version_id])).rows[0];
    if(!v||v.sha256!==r.source_sha256||hash(canonicalJSON({design:v.design,caption:v.caption,brain_id:v.brain_id}))!==v.sha256)throw new CreativeError('EXPORT_SOURCE_CHANGED');
    const saved=(await db.query('SELECT id FROM app.creative_exports WHERE version_id=$1 AND renderer_image=$2',[v.id,r.renderer_image])).rows[0];if(saved){await this.finish(db,j,'succeeded');return null;}
    await db.query("UPDATE app.jobs SET status='running',attempt=attempt+1,error_code=NULL,updated_at=now() WHERE id=$1",[j.id]);return {v,r};
   });
   if(!input)return 'finished';const {v,r}=input;
   const bytes=await this.jobs.store.read(v.object_key);if(bytes.length!==v.media_bytes||digest(bytes)!==v.media_sha256)throw new CreativeError('EXPORT_MEDIA_INTEGRITY_FAILED');
   const rendered=await this.renderer.render(v.design,bytes),key=`exports/${scope.organizationId}/${scope.brandId}/${v.id}/${r.renderer_image.slice(7)}/${rendered.sha256}`;
   await this.jobs.store.persist(key,rendered.bytes,'image/png',rendered.sha256);
   return this.jobs.transaction(scope,async(db,j)=>{
    if(terminal.has(j.status))return j.status;if(!await this.jobs.permitted(db,j))return this.finish(db,j,'canceled','EXPORT_ACCESS_REVOKED');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${j.brand_id}`]);
    const saved=(await db.query('SELECT id FROM app.creative_exports WHERE version_id=$1 AND renderer_image=$2',[v.id,r.renderer_image])).rows[0];
    if(!saved)await db.query('INSERT INTO app.creative_exports(id,organization_id,brand_id,version_id,job_id,source_sha256,renderer_image,media_sha256,object_key,sha256,bytes,width,height,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[randomUUID(),j.organization_id,j.brand_id,v.id,j.id,r.source_sha256,r.renderer_image,v.media_sha256,key,rendered.sha256,rendered.bytes.length,rendered.width,rendered.height,JSON.stringify(rendered.manifest)]);
    return this.finish(db,j,'succeeded');
   });
  }catch(error){if(!(error instanceof CreativeError))throw error;return this.jobs.transaction(scope,async(db,j)=>terminal.has(j.status)?j.status:this.finish(db,j,'rejected',error.code));}
 }
 fail(scope:JobScope){return this.jobs.transaction(scope,(db,j)=>{if(j.kind!=='creative.export')throw new Error('JOB_KIND_DENIED');return terminal.has(j.status)?j.status:this.finish(db,j,'failed','EXPORT_RETRIES_EXHAUSTED');});}
}
