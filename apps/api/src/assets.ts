import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {TenantDatabase} from './database.js';
import {ObjectStore,MAX_UPLOAD_BYTES} from './object-store.js';
import {TYPES} from './file-validation.js';
import {uuid,object,name} from './workspaces.js';
const PUBLIC='id,filename,content_type,expected_bytes,state,error_code,created_at';
export class Assets {
  constructor(readonly database:TenantDatabase,readonly store:ObjectStore){}
  async brand(db:PoolClient,org:string,brand:string){if(!(await db.query('SELECT id FROM app.brands WHERE organization_id=$1 AND id=$2',[org,brand])).rowCount)throw new NotFoundException('Brand not found');}
  async reserve(user:string,org:string,brand:string,input:unknown,key:unknown){
    org=uuid(org);brand=uuid(brand);const value=object(input,['filename','contentType','bytes','sha256']),filename=name(value.filename);
    if(typeof value.contentType!=='string'||!Object.hasOwn(TYPES,value.contentType))throw new BadRequestException('Use PNG, JPEG, WebP, PDF or PPTX');
    if(!Number.isSafeInteger(value.bytes)||Number(value.bytes)<1||Number(value.bytes)>MAX_UPLOAD_BYTES)throw new BadRequestException('Files must be between 1 byte and 20 MB');
    if(typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw new BadRequestException('A SHA-256 checksum is required');
    if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An 8–128 character Idempotency-Key is required');
    const hash=createHash('sha256').update(JSON.stringify([filename,value.contentType,value.bytes,value.sha256])).digest('hex');
    return this.database.transaction(user,org,true,async db=>{
      await this.brand(db,org,brand);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`asset-limit:${org}:${brand}`]);
      const operation=`asset.reserve:${brand}`;
      const {rows:[prior]}=await db.query('SELECT request_hash,response FROM app.idempotency WHERE organization_id=$1 AND operation=$2 AND key=$3',[org,operation,key]);
      let asset;
      if(prior){if(prior.request_hash!==hash)throw new ConflictException('This request key was used for different content');
        asset=(await db.query('SELECT * FROM app.assets WHERE id=$1',[prior.response.id])).rows[0];
        if(!asset || asset.state!=='awaiting_upload')throw new ConflictException('This upload has already been submitted');
      }else{
        const {rows:[usage]}=await db.query(`SELECT COALESCE(sum(expected_bytes + CASE WHEN content_type IN ('image/png','image/jpeg','image/webp') THEN 6291456 ELSE 0 END) FILTER(WHERE state NOT IN ('rejected','failed','canceled')),0)::bigint AS bytes,COALESCE(sum(expected_bytes + CASE WHEN content_type IN ('image/png','image/jpeg','image/webp') THEN 6291456 ELSE 0 END) FILTER(WHERE created_at>now()-interval '24 hours'),0)::bigint AS daily_bytes,count(*) FILTER(WHERE state IN ('awaiting_upload','queued','validating'))::int AS pending FROM app.assets WHERE organization_id=$1 AND brand_id=$2`,[org,brand]);
        if(Number(usage.bytes)+Number(value.bytes)+(String(value.contentType).startsWith('image/')?6291456:0)>1024*1024*1024||Number(usage.daily_bytes)+Number(value.bytes)+(String(value.contentType).startsWith('image/')?6291456:0)>1024*1024*1024||usage.pending>=10)throw new ConflictException('This brand has reached its upload limit');
        const id=randomUUID(),prefix=`${org}/${brand}/${id}`;
        asset=(await db.query(`INSERT INTO app.assets(id,organization_id,brand_id,created_by,filename,content_type,expected_bytes,sha256,quarantine_key,canonical_key)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,org,brand,user,filename,value.contentType,value.bytes,value.sha256,`quarantine/${prefix}`,`assets/${prefix}/${value.sha256}`])).rows[0];
        await db.query(`INSERT INTO app.idempotency(organization_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5)`,[org,operation,key,hash,JSON.stringify({id})]);
      }
      return {id:asset.id,state:asset.state,upload:{url:await this.store.uploadURL(asset.quarantine_key,asset.expected_bytes,asset.content_type),method:'PUT',headers:{'content-type':asset.content_type,'content-length':String(asset.expected_bytes)},expiresIn:120}};
    },brand);
  }
  list(user:string,org:string,brand:string){org=uuid(org);brand=uuid(brand);return this.database.transaction(user,org,false,async db=>{await this.brand(db,org,brand);return {assets:(await db.query(`SELECT ${PUBLIC.split(',').map(column=>'a.'+column).join(',')},j.id AS job_id,j.cancel_requested FROM app.assets a LEFT JOIN app.jobs j ON j.asset_id=a.id AND j.organization_id=a.organization_id AND j.brand_id=a.brand_id AND j.kind='asset.validate' WHERE a.organization_id=$1 AND a.brand_id=$2 ORDER BY a.created_at DESC LIMIT 100`,[org,brand])).rows};},brand);}
  abandon(user:string,org:string,brand:string,id:string){org=uuid(org);brand=uuid(brand);id=uuid(id);return this.database.transaction(user,org,true,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`asset:${id}`]);
    const {rows:[asset]}=await db.query('SELECT id,state FROM app.assets WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[id,org,brand]);
    if(!asset)throw new NotFoundException('Asset not found');
    if(asset.state==='canceled')return asset;
    if(asset.state!=='awaiting_upload')throw new ConflictException('Cancel the validation job for a submitted upload');
    await db.query("UPDATE app.assets SET state='canceled',updated_at=now() WHERE id=$1",[id]);return {id,state:'canceled'};
  },brand);}
  complete(user:string,org:string,brand:string,id:string){org=uuid(org);brand=uuid(brand);id=uuid(id);return this.database.transaction(user,org,true,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`asset:${id}`]);
    const {rows:[asset]}=await db.query('SELECT id,state FROM app.assets WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[id,org,brand]);
    if(!asset)throw new NotFoundException('Asset not found');
    const {rows:[existing]}=await db.query("SELECT id,status FROM app.jobs WHERE asset_id=$1 AND kind='asset.validate'",[id]);if(existing)return existing;
    if(asset.state!=='awaiting_upload')throw new ConflictException('This upload cannot be submitted');
    const job=randomUUID();await db.query(`UPDATE app.assets SET state='queued',updated_at=now() WHERE id=$1`,[id]);
    await db.query(`INSERT INTO app.jobs(id,organization_id,brand_id,asset_id,requested_by,kind) VALUES($1,$2,$3,$4,$5,'asset.validate')`,[job,org,brand,id,user]);
    await db.query('INSERT INTO app.job_dispatch(job_id,organization_id,brand_id) VALUES($1,$2,$3)',[job,org,brand]);
    await db.query(`INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'asset.submitted',$4)`,[org,brand,user,id]);
    return {id:job,status:'queued'};
  },brand);}
  job(user:string,org:string,brand:string,id:string,cancel=false){org=uuid(org);brand=uuid(brand);id=uuid(id);return this.database.transaction(user,org,cancel,async db=>{
    if(cancel)await db.query("UPDATE app.jobs SET cancel_requested=true WHERE id=$1 AND organization_id=$2 AND brand_id=$3 AND status IN ('queued','running','retrying')",[id,org,brand]);
    const {rows:[job]}=await db.query('SELECT id,asset_id,status,cancel_requested,attempt,error_code FROM app.jobs WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[id,org,brand]);if(!job)throw new NotFoundException('Job not found');return job;
  },brand);}
  extract(user:string,org:string,brand:string,id:string,key:unknown){org=uuid(org);brand=uuid(brand);id=uuid(id);
    if(typeof key!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('An Idempotency-Key is required');
    return this.database.transaction(user,org,true,async db=>{
      await this.brand(db,org,brand);await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`document-limit:${org}:${brand}`]);
      const operation=`document.extract:${brand}`,hash=createHash('sha256').update(id).digest('hex');
      const prior=(await db.query('SELECT request_hash,response FROM app.idempotency WHERE organization_id=$1 AND operation=$2 AND key=$3',[org,operation,key])).rows[0];
      if(prior){if(prior.request_hash!==hash)throw new ConflictException('This request key was used for another document');return prior.response;}
      const asset=(await db.query('SELECT * FROM app.assets WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[id,org,brand])).rows[0];
      if(!asset)throw new NotFoundException('Asset not found');
      if(asset.state!=='ready')throw new ConflictException('Wait for file validation before extracting brand evidence');
      if(!['application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(asset.content_type))throw new BadRequestException('Choose a PDF or PPTX document');
      const usage=(await db.query("SELECT count(*) FILTER(WHERE created_at>now()-interval '24 hours')::int AS daily,count(*) FILTER(WHERE status IN ('queued','running','retrying'))::int AS pending FROM app.jobs WHERE organization_id=$1 AND brand_id=$2 AND kind='document.extract'",[org,brand])).rows[0];
      if(usage.daily>=50||usage.pending>=3)throw new ConflictException('This brand has reached its document processing limit');
      const job=randomUUID(),result={id:job,status:'queued'};
      await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,asset_id,requested_by,kind) VALUES($1,$2,$3,$4,$5,'document.extract')",[job,org,brand,id,user]);
      await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'document.extract')",[job,org,brand]);
      await db.query('INSERT INTO app.idempotency(organization_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5)',[org,operation,key,hash,JSON.stringify(result)]);
      await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'document.submitted',$4)",[org,brand,user,job]);return result;
    },brand);
  }
  download(user:string,org:string,brand:string,id:string){org=uuid(org);brand=uuid(brand);id=uuid(id);return this.database.transaction(user,org,false,async db=>{
    const {rows:[asset]}=await db.query('SELECT id,state,canonical_key,content_type FROM app.assets WHERE id=$1 AND organization_id=$2 AND brand_id=$3',[id,org,brand]);
    if(!asset)throw new NotFoundException('Asset not found');if(asset.state!=='ready')throw new ConflictException('This file has not passed validation');
    return {url:await this.store.downloadURL(asset.canonical_key,`${id}${TYPES[asset.content_type]}`,asset.content_type),expiresIn:60};
  },brand);}
}
