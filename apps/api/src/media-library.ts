import {BadRequestException,NotFoundException} from '@nestjs/common';
import type {ImagePreviews} from './image-previews.js';
import {etagMatches,previewEtag,previewKey,previewWidth,type MediaKind,type MediaSource,type PreviewWidth} from './media-variants.js';
import {uuid} from './workspaces.js';

type Queryable={query(sql:string,params:unknown[]):Promise<{rows:{object_key:string;sha256:string}[]}>};
/** The part of Canvas this needs: the same membership, business-access and row-level-security
 * transaction every other read of this media goes through. */
export type MediaScope={
 scope<T>(user:string,id:string,write:boolean,action:(db:Queryable,business:{organization_id:string})=>Promise<T>):Promise<T>;
 store:{previews:Pick<ImagePreviews,'get'>};
};
export type MediaReply={status:304;etag:string}|{status:200;etag:string;bytes:Buffer};

// One query per request. Tenant filters are explicit as well as enforced by row-level security.
const LOOKUPS:Record<MediaKind,{sql:string;missing:string}>={
 creative:{sql:'SELECT object_key,sha256 FROM app.creative_media WHERE organization_id=$1 AND brand_id=$2 AND id=$3',missing:'Creative image not found'},
 export:{sql:'SELECT object_key,sha256 FROM app.creative_exports WHERE organization_id=$1 AND brand_id=$2 AND id=$3',missing:'Saved export not found'},
 poster:{sql:'SELECT poster_key AS object_key,poster_sha256 AS sha256 FROM app.video_versions WHERE organization_id=$1 AND brand_id=$2 AND id=$3',missing:'Video not found'},
 cover:{sql:'SELECT e.object_key,e.sha256 FROM app.carousel_pages p JOIN app.creative_exports e ON e.organization_id=p.organization_id AND e.brand_id=p.brand_id AND e.id=p.export_id WHERE p.organization_id=$1 AND p.brand_id=$2 AND p.carousel_version_id=$3 AND p.position=0',missing:'Carousel cover not found'},
};

/** Authenticated previews of private media. Authorization runs on every call, before the
 * validator, the memory cache or storage is consulted. */
export class MediaLibrary {
 constructor(private readonly canvas:MediaScope){}
 async preview(user:string,businessId:string,source:MediaSource,requestedWidth:unknown,ifNoneMatch:string|undefined):Promise<MediaReply>{
  const lookup=LOOKUPS[source?.kind];
  if(!lookup)throw new BadRequestException('Unknown media kind');
  const width=this.width(requestedWidth),id=uuid(source.id);
  const media=await this.canvas.scope(user,businessId,false,async(db,business)=>{
   const row=(await db.query(lookup.sql,[business.organization_id,businessId,id])).rows[0];
   if(!row)throw new NotFoundException(lookup.missing);
   // Defence in depth: the object itself must sit in this tenant's prefix.
   try{previewKey(row.object_key,row.sha256,width,{organizationId:business.organization_id,brandId:businessId});}
   catch{throw new NotFoundException(lookup.missing);}
   return row;
  });
  const etag=previewEtag(media.sha256,width);
  if(etagMatches(ifNoneMatch,etag))return {status:304,etag};
  // The transformation runs outside the database transaction.
  return {status:200,etag,bytes:(await this.canvas.store.previews.get(media.object_key,media.sha256,width)).bytes};
 }
 private width(requested:unknown):PreviewWidth{
  try{return previewWidth(requested);}catch{throw new BadRequestException('Invalid preview width');}
 }
}
