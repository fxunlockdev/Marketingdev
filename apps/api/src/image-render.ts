/** The image call of a creative, assembled from stored data: prompt, size, quality and every
 * reference picture with its role. Pure apart from image decoding, so the job, the "what the
 * model sees" audit and the quality harness all send exactly the same thing. */
import sharp from 'sharp';
import {CreativeError,type CreativeBrief} from './creative-contracts.js';
import type {CreativeProvider} from './creative-provider.js';
import {buildImagePrompt,type IdentityFact} from './image-prompt.js';
import {resolveTextMode,type ParentText} from './image-typography.js';
import {approvedDirection,type ApprovedMoodboard} from './image-direction.js';
import {creativeDimensions,legacyCreativeDimensions,creativeSourceSize,type CreativeSpec} from './campaign-formats.js';
import {frameCreative,frameDirection,type Framing} from './creative-framing.js';
import {stockReferenceLabel,type StockUse} from './stock-planning.js';
import type {PostArtwork} from './post-artwork.js';
import type {TextMode} from './image-art-direction.js';
import {digest} from './object-store.js';

/** Longest edge of a reference picture sent to the image model. */
export const REFERENCE_EDGE=1536;
const IDENTITY_FIELDS=['brand_name','offering','audience','voice','colors','prohibited_claims'];
export type Crop={left:number;top:number;width:number;height:number};
/** An approved brand reference as stored: the original JPEG plus its approved crop. */
export type BrandReference={id?:string;visual_id?:string;kind?:string;label:string;crop?:Crop|null;source_sha256?:string;bytes:Buffer;width?:number;height?:number};
export type ReferenceManifestEntry={kind:string;label:string;input_sha256:string;id?:string;visual_id?:string;crop?:Crop|null;source_sha256?:string};
export type ParentImage={bytes:Buffer;text:ParentText;design?:{width:unknown;height:unknown}};
export type ImageCallInput={
 brief:CreativeBrief;
 facts:readonly IdentityFact[];
 /** The request's prompt: carries a saved campaign's design direction. */
 prompt:string;
 references:readonly BrandReference[];
 stock:{photo:Buffer;use:StockUse}|null;
 moodboard:ApprovedMoodboard|null;
 placement:CreativeSpec|null;
 /** Provider size stored on the request; used when there is no placement. */
 requestSize?:string;
 model:string;
 quality:string;
 parent:ParentImage|null;
 artwork?:PostArtwork;
};
export type RenderedImage={bytes:Buffer;sha256:string;width:number;height:number;usage:unknown;created:unknown;framing:Framing|null;
 /** The provider's own output, kept for provenance when the stored creative was framed from it. */
 source?:{bytes:Buffer;sha256:string}};
export type ImageCallPlan={
 prompt:string;size:string;quality:string;model:string;textMode:TextMode;
 identity:IdentityFact[];references:Buffer[];manifest:ReferenceManifestEntry[];
 target:{width:number;height:number}|null;placement:CreativeSpec|null;
 /** Generate with `prompt` (the base prompt plus any retry notes) and frame to the placement. */
 render:(provider:CreativeProvider,safetyIdentifier:string,prompt?:string)=>Promise<RenderedImage>;
};

/** Facts the image model may see: identity, colours, claims and approved visual direction. */
export function identityFacts(facts:readonly IdentityFact[]):IdentityFact[]{
 return facts.filter(f=>IDENTITY_FIELDS.includes(f.field)||f.field.startsWith('visual_direction_'));
}

/** Decode an approved reference exactly as approved (JPEG, recorded size, crop) and re-encode it losslessly. */
export async function canonicalReference(reference:BrandReference):Promise<Buffer>{
 try{
  const decoder=sharp(reference.bytes,{limitInputPixels:24_000_000}),metadata=await decoder.metadata();
  if(metadata.format!=='jpeg'||(reference.width!==undefined&&metadata.width!==reference.width)||(reference.height!==undefined&&metadata.height!==reference.height))throw new Error('Invalid source');
  return await (reference.crop?decoder.extract(reference.crop):decoder).resize({width:REFERENCE_EDGE,height:REFERENCE_EDGE,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 }catch{throw new CreativeError('CREATIVE_REFERENCE_INVALID');}
}

async function stockReference(photo:Buffer):Promise<Buffer>{
 return sharp(photo,{limitInputPixels:24_000_000}).resize({width:REFERENCE_EDGE,height:REFERENCE_EDGE,fit:'inside',withoutEnlargement:true}).png().toBuffer();
}

function targetFor(input:ImageCallInput):{width:number;height:number}|null{
 const placement=input.placement;
 if(!placement)return null;
 const design=input.parent?.design;
 return design&&legacyCreativeDimensions(placement,design)?{width:Number(design.width),height:Number(design.height)}:creativeDimensions(placement);
}

export async function imageCallPlan(input:ImageCallInput):Promise<ImageCallPlan>{
 const references:Buffer[]=[],manifest:ReferenceManifestEntry[]=[];
 for(const r of input.references){
  const canonical=await canonicalReference(r);
  references.push(canonical);
  manifest.push({id:r.id,visual_id:r.visual_id,kind:r.kind??'upload',label:r.label,crop:r.crop??null,source_sha256:r.source_sha256??digest(r.bytes),input_sha256:digest(canonical)});
 }
 if(input.stock){
  const stock=await stockReference(input.stock.photo);
  references.push(stock);
  manifest.push({kind:`stock_${input.stock.use}`,label:stockReferenceLabel(input.stock.use),input_sha256:digest(stock)});
 }
 const identity=identityFacts(input.facts);
 const textMode=resolveTextMode({brief:input.brief,artwork:input.artwork,parent:input.parent?input.parent.text:null});
 const target=targetFor(input),placement=input.placement;
 const frame=placement&&target?frameDirection(placement,target):undefined;
 const size=input.requestSize??(placement?creativeSourceSize(placement):'1024x1024');
 const prompt=buildImagePrompt({brief:input.brief,identity,references:manifest,hasParent:!!input.parent,textMode,artwork:input.artwork,frame,approvedDirection:approvedDirection(input.moodboard,input.prompt)});
 const render=async(provider:CreativeProvider,safetyIdentifier:string,override?:string):Promise<RenderedImage>=>{
  const output=await provider.image(input.model,override??prompt,size,input.quality,safetyIdentifier,input.parent?.bytes,references);
  if(!placement||!target||(output.width===target.width&&output.height===target.height))return {...output,framing:null};
  const framed=await frameCreative(output.bytes,placement,'cover',target);
  return {bytes:Buffer.from(framed.bytes),sha256:framed.sha256,width:framed.width,height:framed.height,usage:output.usage,created:output.created,framing:framed.framing,source:{bytes:output.bytes,sha256:output.sha256}};
 };
 return {prompt,size,quality:input.quality,model:input.model,textMode,identity,references,manifest,target,placement,render};
}
