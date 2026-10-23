import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { object, uuid } from './workspaces.js';
export const referenceColumns = `r.id,r.label,r.crop,r.approved_at,r.revoked_at,COALESCE(r.website_visual_id,r.document_visual_id,r.uploaded_visual_id) AS visual_id,
 CASE WHEN r.website_visual_id IS NOT NULL THEN 'website' WHEN r.document_visual_id IS NOT NULL THEN 'document' ELSE 'upload' END AS kind,
 COALESCE(w.object_key,d.object_key,u.object_key) AS object_key,COALESCE(w.sha256,d.sha256,u.sha256) AS sha256,
 COALESCE(w.bytes,d.bytes,u.bytes) AS bytes,COALESCE(w.width,d.width,u.width) AS width,COALESCE(w.height,d.height,u.height) AS height`;
export const referenceJoins = `LEFT JOIN app.website_visuals w ON w.id=r.website_visual_id LEFT JOIN app.document_visuals d ON d.id=r.document_visual_id LEFT JOIN app.uploaded_visuals u ON u.id=r.uploaded_visual_id`;
export async function approveReference(db:any,org:string,brand:string,user:string,body:unknown){
 const v=object(body,['kind','visual_id','label','consent','crop']);
 if(!['website','document','upload'].includes(String(v.kind))||v.consent!==true||typeof v.label!=='string'||!v.label.trim()||v.label.trim().length>140||/[\u0000-\u001f]/.test(v.label))throw new BadRequestException('Choose an image, label it and confirm permission to use it for AI creatives');
 const visual=uuid(String(v.visual_id)),label=v.label.trim();
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`canvas:${brand.toLowerCase()}`]);
 const table=v.kind==='website'?'website_visuals':v.kind==='document'?'document_visuals':'uploaded_visuals',column=v.kind==='website'?'website_visual_id':v.kind==='document'?'document_visual_id':'uploaded_visual_id';
 const source=(await db.query(`SELECT id,width,height FROM app.${table} WHERE organization_id=$1 AND brand_id=$2 AND id=$3`,[org,brand,visual])).rows[0];
 if(!source)throw new NotFoundException('Source image not found');
 let crop=null;
 if(v.crop!=null){const c=object(v.crop,['left','top','width','height']);if(![c.left,c.top,c.width,c.height].every(Number.isSafeInteger)||Number(c.left)<0||Number(c.top)<0||Number(c.width)<1||Number(c.height)<1||Number(c.left)+Number(c.width)>source.width||Number(c.top)+Number(c.height)>source.height)throw new BadRequestException('Choose a crop within the source image');crop={left:c.left,top:c.top,width:c.width,height:c.height};}
 const prior=(await db.query(`SELECT id,crop FROM app.brand_references WHERE organization_id=$1 AND brand_id=$2 AND ${column}=$3 AND revoked_at IS NULL`,[org,brand,visual])).rows[0];
 if(prior){if(JSON.stringify(prior.crop)!==JSON.stringify(crop)&&!(prior.crop&&crop&&Object.keys(crop).every(k=>(prior.crop as any)[k]===(crop as any)[k])))throw new ConflictException('Remove the current reference approval before choosing a different crop');return {id:prior.id};}
 if((await db.query('SELECT count(*)::int AS n FROM app.brand_references WHERE organization_id=$1 AND brand_id=$2 AND revoked_at IS NULL',[org,brand])).rows[0].n>=30)throw new ConflictException('Remove an approved reference before adding more');
 const id=randomUUID();
 await db.query(`INSERT INTO app.brand_references(id,organization_id,brand_id,${column},label,approved_by,crop) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,org,brand,visual,label,user,crop?JSON.stringify(crop):null]);
 await db.query("INSERT INTO app.audit_events(organization_id,brand_id,actor_id,action,resource_id) VALUES($1,$2,$3,'brand.reference_approved',$4)",[org,brand,user,id]);
 return {id};
}
