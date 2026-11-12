import {validPostArtwork,type PostArtwork} from './post-artwork.js';
/** Shared pure format vocabulary. Missing specifications are legacy, never inferred. */
export type CreativeSpec={placement:'feed'|'story'|'reel';aspect:'square'|'portrait'|'landscape'|'vertical';slide_count:number|null;artwork?:PostArtwork};
export function normalizeCreativeSpec(value:unknown,format:string,channel:string):CreativeSpec{
 const invalid=()=>{throw Object.assign(new Error('Choose a compatible post placement, aspect and slide count'),{code:'CAMPAIGN_FORMAT_INVALID'});};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).filter(k=>k!=='artwork').sort().join(',')!=='aspect,placement,slide_count'||!['static','ad','video','carousel'].includes(format)||!['instagram','facebook','linkedin'].includes(channel))return invalid();
 if(v.artwork!==undefined&&(!['static','ad','carousel'].includes(format)||!validPostArtwork(v.artwork)))return invalid();
 if(!['feed','story','reel'].includes(String(v.placement))||!['square','portrait','landscape','vertical'].includes(String(v.aspect)))return invalid();
 if(v.placement==='feed'?(v.aspect==='vertical'):(v.aspect!=='vertical'||channel==='linkedin'||format==='ad'||format==='carousel'))return invalid();
 if(v.placement==='reel'&&format!=='video')return invalid();
 if(format==='carousel'?!Number.isInteger(v.slide_count)||Number(v.slide_count)<2||Number(v.slide_count)>10:v.slide_count!==null)return invalid();
 const artwork=v.artwork as PostArtwork|undefined;
 const typography=artwork?.typography;
 const spec:CreativeSpec={placement:v.placement as CreativeSpec['placement'],aspect:v.aspect as CreativeSpec['aspect'],slide_count:v.slide_count as number|null,
  ...(artwork?{artwork:{text:artwork.text,...(typography?{typography:{
   headline:{family:typography.headline.family,weight:typography.headline.weight},
   body:{family:typography.body.family,weight:typography.body.weight},
  }}:{})}}:{})};
 if(format==='video')VIDEO_SPECS.add(spec);
 return spec;
}
type Dimensions={width:number;height:number};
/** Specs normalised for a video. Tracked out of band so stored and compared specs stay unchanged. */
const VIDEO_SPECS=new WeakSet<CreativeSpec>();
/** The size a new creative is composed at. A portrait image is a true 4:5 feed post; the provider's
 * 2:3 output is cover-cropped to it (see creative-framing). A spec normalised for a portrait video
 * still reports the provider's 2:3 source size here; the finished portrait video itself is rendered
 * at a true 4:5 (1080x1350, see videoTarget in reel-plan), and its starting frame is a 4:5 image. */
export function creativeDimensions(spec:CreativeSpec):Dimensions{
 if(spec.aspect==='portrait'&&VIDEO_SPECS.has(spec))return {width:1024,height:1536};
 return {square:{width:1024,height:1024},portrait:{width:1024,height:1280},landscape:{width:1536,height:1024},vertical:{width:1080,height:1920}}[spec.aspect];
}
/** Portrait creatives made before 4:5 were stored at the provider's 2:3 size. They stay valid:
 * they can still be edited (keeping their size) and attached to portrait posts. */
const LEGACY_DIMENSIONS:Partial<Record<CreativeSpec['aspect'],readonly Dimensions[]>>={portrait:[{width:1024,height:1536}]};
export function acceptedCreativeDimensions(spec:CreativeSpec):Dimensions[]{
 return [creativeDimensions(spec),...(LEGACY_DIMENSIONS[spec.aspect]??[])];
}
export function matchesCreativeDimensions(spec:CreativeSpec,size:{width?:unknown;height?:unknown}|null|undefined):boolean{
 return !!size&&acceptedCreativeDimensions(spec).some(d=>d.width===size.width&&d.height===size.height);
}
/** True when an existing creative was made at a superseded size for its aspect. */
export function legacyCreativeDimensions(spec:CreativeSpec,size:{width?:unknown;height?:unknown}|null|undefined):boolean{
 return !!size&&(LEGACY_DIMENSIONS[spec.aspect]??[]).some(d=>d.width===size.width&&d.height===size.height);
}
export function creativeSourceSize(spec:CreativeSpec):'1024x1024'|'1024x1536'|'1536x1024'{
 return spec.aspect==='square'?'1024x1024':spec.aspect==='landscape'?'1536x1024':'1024x1536';
}
