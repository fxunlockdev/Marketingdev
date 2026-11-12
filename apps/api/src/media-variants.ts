/** Display derivatives of private media: the contract shared by the API, the worker and the web bundle.
 * Pure and browser-safe (no Node imports). Originals are never altered and are never served from these paths.
 */
export const PREVIEW_WIDTHS=[320,640,1280] as const;
export type PreviewWidth=typeof PREVIEW_WIDTHS[number];
export const DEFAULT_PREVIEW_WIDTH:PreviewWidth=640;
/** Bump when the encoder settings change: storage keys and ETags change with it, so stale bytes are never reused. */
export const PREVIEW_PIPELINE='v1';
/** Media rows are insert-only and content-addressed, so a response for one row and width can never change.
 * `private` keeps it out of shared caches; every request that reaches the API is still authorized. */
export const PREVIEW_CACHE_CONTROL='private, max-age=31536000, immutable';
export const MAX_PREVIEW_BYTES=1024*1024;

export type MediaKind='creative'|'export'|'poster'|'cover';
export type MediaSource={kind:MediaKind;id:string};
export type PreviewTenant={organizationId:string;brandId:string};

const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHA256=/^[a-f0-9]{64}$/;
// <kind>/<organization>/<brand>/…/<sha256 of the original>, as written by every media producer.
const SOURCE_KEY=new RegExp(`^[a-z][a-z0-9-]*/(${UUID})/(${UUID})/(?:(?!\\.{1,2}/)[A-Za-z0-9._:-]+/)*([a-f0-9]{64})$`);
const isWidth=(value:number):value is PreviewWidth=>(PREVIEW_WIDTHS as readonly number[]).includes(value);

/** Resolve the `w` query value to a stored variant: the smallest one that is at least as wide. */
export function previewWidth(requested:unknown):PreviewWidth{
 if(requested===undefined)return DEFAULT_PREVIEW_WIDTH;
 if(typeof requested!=='string'||!/^[1-9][0-9]{0,3}$/.test(requested)||Number(requested)>4096)throw new RangeError('Invalid preview width');
 const wanted=Number(requested);
 return PREVIEW_WIDTHS.find(width=>width>=wanted)??PREVIEW_WIDTHS[PREVIEW_WIDTHS.length-1];
}

/** Private storage key of one variant. Derived only from the original's own key, so it stays inside the same
 * tenant prefix and is generated at most once per original, width and pipeline version. */
export function previewKey(sourceKey:string,sourceSha256:string,width:number,tenant?:PreviewTenant):string{
 if(!isWidth(width))throw new RangeError('Invalid preview width');
 const match=SOURCE_KEY.exec(sourceKey);
 if(!match)throw new Error('Invalid preview source key');
 if(!SHA256.test(sourceSha256)||match[3]!==sourceSha256)throw new Error('Preview source is not content-addressed');
 if(tenant&&(match[1]!==tenant.organizationId.toLowerCase()||match[2]!==tenant.brandId.toLowerCase()))throw new Error('Preview source belongs to another tenant');
 return `previews/${PREVIEW_PIPELINE}/${sourceKey}/w${width}.webp`;
}

/** Strong validator known from the database row alone, so a 304 needs no storage read. */
export function previewEtag(sourceSha256:string,width:PreviewWidth):string{
 if(!SHA256.test(sourceSha256))throw new Error('Invalid preview source');
 return `"${PREVIEW_PIPELINE}-${sourceSha256}-w${width}"`;
}

export function etagMatches(ifNoneMatch:string|undefined,etag:string):boolean{
 if(!ifNoneMatch)return false;
 return ifNoneMatch.split(',').map(value=>value.trim()).some(value=>value==='*'||value===etag||value==='W/'+etag);
}

const PATHS:Record<MediaKind,(id:string)=>string>={
 creative:id=>`creative-media/${id}/preview`,
 export:id=>`creative-exports/${id}/preview`,
 poster:id=>`video-versions/${id}/poster/preview`,
 cover:id=>`carousel-versions/${id}/cover`,
};
const resourceId=(value:string):string=>{
 if(!new RegExp(`^${UUID}$`,'i').test(value))throw new Error('Invalid resource ID');
 return value.toLowerCase();
};

/** Stable, same-origin URL of one variant. Stable URLs are what let the browser cache them. */
export function mediaPreviewPath(businessId:string,source:MediaSource,width:PreviewWidth):string{
 const path=PATHS[source.kind];
 if(!path)throw new Error('Unknown media kind');
 return `/api/v1/businesses/${resourceId(businessId)}/${path(resourceId(source.id))}?w=${width}`;
}

/** `srcset` for an <img>. Pass the original's pixel width when known so no candidate claims more pixels than exist. */
export function mediaSrcSet(businessId:string,source:MediaSource,intrinsicWidth?:number):string{
 const limit=intrinsicWidth&&Number.isFinite(intrinsicWidth)&&intrinsicWidth>0?intrinsicWidth:Infinity;
 return PREVIEW_WIDTHS.map(width=>`${mediaPreviewPath(businessId,source,width)} ${Math.min(width,limit)}w`).join(', ');
}

/** Variant for a slot measured in CSS pixels, for surfaces that cannot use `srcset` (SVG <image>). */
export function pickPreviewWidth(cssPixels:number,devicePixelRatio:number):PreviewWidth{
 if(!Number.isFinite(cssPixels)||cssPixels<=0)return DEFAULT_PREVIEW_WIDTH;
 const density=Number.isFinite(devicePixelRatio)?Math.min(3,Math.max(1,devicePixelRatio)):1;
 const needed=Math.ceil(cssPixels*density);
 return PREVIEW_WIDTHS.find(width=>width>=needed)??PREVIEW_WIDTHS[PREVIEW_WIDTHS.length-1];
}

export type CoverPost={export_id?:string|null;slides?:{export_id?:string|null}[]|null;video_version_id?:string|null;carousel_version_id?:string|null;design?:{background_media_id?:string|null}|null};
/** The one image that represents a post on a card, from fields every listing already returns. */
export function postCoverSource(post:CoverPost):MediaSource|null{
 const exported=post.export_id??post.slides?.[0]?.export_id;
 if(exported)return {kind:'export',id:exported};
 if(post.video_version_id)return {kind:'poster',id:post.video_version_id};
 if(post.carousel_version_id)return {kind:'cover',id:post.carousel_version_id};
 if(post.design?.background_media_id)return {kind:'creative',id:post.design.background_media_id};
 return null;
}
