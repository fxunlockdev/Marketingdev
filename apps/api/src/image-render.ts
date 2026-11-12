/** The image call of a creative, assembled from stored data: prompt, size, quality and every
 * reference picture with its role. Pure apart from image decoding, so the job, the "what the
 * model sees" audit and the quality harness all send exactly the same thing.
 *
 * Briefs with art direction (every brief since art direction exists) get the full pipeline:
 * brand references first, then the stock photo, then the approved mood board as STYLE references;
 * the customer's own rejections as must-avoid instructions; a 2K master in the placement's exact
 * aspect, downsampled losslessly to the platform size; and the approved logo composited, never
 * redrawn. Briefs saved before art direction keep their earlier request byte for byte. */
import sharp from 'sharp';
import {CreativeError,type CreativeBrief} from './creative-contracts.js';
import {MAX_IMAGE_REFERENCES,type CreativeProvider} from './creative-provider.js';
import {buildImagePrompt,type IdentityFact} from './image-prompt.js';
import {resolveTextMode,type ParentText} from './image-typography.js';
import {approvedDirection,type ApprovedMoodboard} from './image-direction.js';
import {imageFeedback,type ImageFeedback} from './image-preferences.js';
import {compositeLogo,isLogoLabel,type LogoLockup} from './image-logo.js';
import {masterImageSize} from './model-policy.js';
import {creativeDimensions,legacyCreativeDimensions,creativeSourceSize,type CreativeSpec} from './campaign-formats.js';
import {frameCreative,frameDirection,type Framing} from './creative-framing.js';
import {stockReferenceLabel,type StockUse} from './stock-planning.js';
import type {LearningContext} from './learning-context.js';
import type {PostArtwork} from './post-artwork.js';
import type {TextMode} from './image-art-direction.js';
import {digest} from './object-store.js';

/** Longest edge of a reference picture: 2K for art-directed briefs, the earlier 1536 for legacy ones. */
export const REFERENCE_EDGE=2048;
const LEGACY_REFERENCE_EDGE=1536;
/** Mood board images are style guidance; a smaller copy carries colour, light and type character. */
const STYLE_EDGE=1024,MAX_STYLE_REFERENCES=2;
export const STYLE_REFERENCE_LABEL='STYLE REFERENCE: the customer-approved mood board, which is the creative direction for this business. Match its colour grading, light, typography character and overall feel. Do not copy its subject, objects, layout or any lettering in it.';
const IDENTITY_FIELDS=['brand_name','offering','audience','voice','colors','prohibited_claims'];
export type Crop={left:number;top:number;width:number;height:number};
/** An approved brand reference as stored: the original JPEG plus its approved crop. */
export type BrandReference={id?:string;visual_id?:string;kind?:string;label:string;crop?:Crop|null;source_sha256?:string;bytes:Buffer;width?:number;height?:number};
export type ReferenceManifestEntry={kind:string;label:string;input_sha256:string;id?:string;visual_id?:string;crop?:Crop|null;source_sha256?:string};
export type ParentImage={bytes:Buffer;text:ParentText;design?:{width:unknown;height:unknown}};
/** The locked mood board: its direction and, when available, its generated image and carousel cover. */
export type MoodboardInput=ApprovedMoodboard&{images?:{label:string;bytes:Buffer}[]};
/** The approved logo file: attached to the request, or the business's approved logo reference. */
export type LogoInput={bytes:Buffer;reference_id?:string;source:'attached'|'approved'};
export type ImageCallInput={
 brief:CreativeBrief;
 facts:readonly IdentityFact[];
 /** The request's prompt: carries a saved campaign's design direction. */
 prompt:string;
 references:readonly BrandReference[];
 stock:{photo:Buffer;use:StockUse}|null;
 moodboard:MoodboardInput|null;
 placement:CreativeSpec|null;
 /** Provider size stored on the request; used when there is no placement. */
 requestSize?:string;
 model:string;
 quality:string;
 parent:ParentImage|null;
 artwork?:PostArtwork;
 /** The saved learning context of the request (customer preferences among it). */
 learning?:LearningContext|null;
 logo?:LogoInput|null;
 /** Most mood board style images the request budget allows (default two). */
 styleLimit?:number;
};
export type RenderedImage={bytes:Buffer;sha256:string;width:number;height:number;usage:unknown;created:unknown;framing:Framing|null;
 /** The provider's own output (the 2K master when it was generated), kept for provenance. */
 source?:{bytes:Buffer;sha256:string};
 master?:{width:number;height:number;sha256:string};
 logo?:LogoLockup};
export type ImageCallPlan={
 prompt:string;size:string;fallbackSize?:string;quality:string;model:string;textMode:TextMode;
 identity:IdentityFact[];references:Buffer[];manifest:ReferenceManifestEntry[];
 target:{width:number;height:number}|null;placement:CreativeSpec|null;
 feedback:ImageFeedback;
 /** Short descriptions of what the customer rejected, for the vision check. */
 mustAvoid:string[];
 logo:{source:LogoInput['source'];reference_id?:string;sha256:string;placement:string}|null;
 /** Generate with `prompt` (the base prompt plus any retry notes), frame to the placement, add the logo. */
 render:(provider:CreativeProvider,safetyIdentifier:string,prompt?:string)=>Promise<RenderedImage>;
};

/** Facts the image model may see: identity, colours, claims and approved visual direction. */
export function identityFacts(facts:readonly IdentityFact[]):IdentityFact[]{
 return facts.filter(f=>IDENTITY_FIELDS.includes(f.field)||f.field.startsWith('visual_direction_'));
}

/** References that are scene content. A logo is composited, so it never makes stock unnecessary. */
export function sceneReferences(references:readonly {label:string}[]):number{
 return references.filter(r=>!isLogoLabel(r.label)).length;
}

/** Decode an approved reference exactly as approved (JPEG, recorded size, crop) and re-encode it losslessly. */
export async function canonicalReference(reference:BrandReference,edge=LEGACY_REFERENCE_EDGE):Promise<Buffer>{
 try{
  const decoder=sharp(reference.bytes,{limitInputPixels:24_000_000}),metadata=await decoder.metadata();
  if(metadata.format!=='jpeg'||(reference.width!==undefined&&metadata.width!==reference.width)||(reference.height!==undefined&&metadata.height!==reference.height))throw new Error('Invalid source');
  return await (reference.crop?decoder.extract(reference.crop):decoder).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).png().toBuffer();
 }catch{throw new CreativeError('CREATIVE_REFERENCE_INVALID');}
}

const inside=(bytes:Buffer,edge:number):Promise<Buffer>=>sharp(bytes,{limitInputPixels:24_000_000}).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).png().toBuffer();
const dimensions=(size:string):{width:number;height:number}=>{const [width,height]=size.split('x').map(Number);return {width,height};};

function targetFor(input:ImageCallInput):{width:number;height:number}|null{
 const placement=input.placement;
 if(!placement)return null;
 const design=input.parent?.design;
 return design&&legacyCreativeDimensions(placement,design)?{width:Number(design.width),height:Number(design.height)}:creativeDimensions(placement);
}

/** Frame note for the prompt. A 2K master in the exact aspect is downsampled, never cropped. */
function frameNote(placement:CreativeSpec,target:{width:number;height:number},size:string):string|undefined{
 const source=dimensions(size);
 if(Math.abs(source.width/source.height-target.width/target.height)>0.01)return frameDirection(placement,target);
 return [`The finished post is ${target.width}x${target.height}, downsampled from this canvas without cropping.`,'Fill the whole canvas with the scene, edge to edge. No borders, bars, frames or blank bands.',
  ...(placement.placement==='feed'?[]:['This is a full-screen vertical story: also keep the headline, call to action and logo out of the top 14% and bottom 20%, where the app interface sits.'])].join(' ');
}

type Assembled={references:Buffer[];manifest:ReferenceManifestEntry[]};
async function modelReferences(input:ImageCallInput,directed:boolean):Promise<Assembled>{
 const references:Buffer[]=[],manifest:ReferenceManifestEntry[]=[],edge=directed?REFERENCE_EDGE:LEGACY_REFERENCE_EDGE;
 // Brand references first: the real product, premises and people the customer approved.
 for(const r of input.references){
  if(directed&&isLogoLabel(r.label))continue;
  const canonical=await canonicalReference(r,edge);
  references.push(canonical);
  manifest.push({id:r.id,visual_id:r.visual_id,kind:r.kind??'upload',label:r.label,crop:r.crop??null,source_sha256:r.source_sha256??digest(r.bytes),input_sha256:digest(canonical)});
 }
 if(input.stock){
  const stock=await inside(input.stock.photo,edge);
  references.push(stock);
  manifest.push({kind:`stock_${input.stock.use}`,label:stockReferenceLabel(input.stock.use),input_sha256:digest(stock)});
 }
 // Then the mood board as style guidance, within the cap. An edit keeps its own picture's look.
 if(directed&&!input.parent){
  const room=Math.max(0,Math.min(MAX_STYLE_REFERENCES,MAX_IMAGE_REFERENCES-references.length,input.styleLimit??MAX_STYLE_REFERENCES));
  for(const image of (input.moodboard?.images??[]).slice(0,room)){
   const style=await inside(image.bytes,STYLE_EDGE);
   references.push(style);
   manifest.push({kind:'style_moodboard',label:`${STYLE_REFERENCE_LABEL} (${image.label})`,input_sha256:digest(style)});
  }
 }
 return {references,manifest};
}

async function toStored(bytes:Buffer,placement:CreativeSpec|null,stored:{width:number;height:number}):Promise<{bytes:Buffer;framing:Framing|null}>{
 if(placement){const framed=await frameCreative(bytes,placement,'cover',stored);return {bytes:Buffer.from(framed.bytes),framing:framed.framing};}
 // Same aspect: a lossless high-quality downsample of the master.
 return {bytes:await sharp(bytes,{limitInputPixels:24_000_000}).resize(stored.width,stored.height,{fit:'cover',kernel:'lanczos3'}).png().toBuffer(),framing:null};
}

export async function imageCallPlan(input:ImageCallInput):Promise<ImageCallPlan>{
 const directed=!!input.brief.art_direction;
 const {references,manifest}=await modelReferences(input,directed);
 const identity=identityFacts(input.facts);
 const textMode=resolveTextMode({brief:input.brief,artwork:input.artwork,parent:input.parent?input.parent.text:null});
 const target=targetFor(input),placement=input.placement;
 const legacySize=input.requestSize??(placement?creativeSourceSize(placement):'1024x1024');
 const stored=target??dimensions(legacySize);
 const master=directed?masterImageSize(input.model,stored):null;
 const size=master??legacySize,fallbackSize=master&&master!==legacySize?legacySize:undefined;
 const frame=placement&&target?(master?frameNote(placement,target,master):frameDirection(placement,target)):undefined;
 const feedback=directed?imageFeedback(input.learning):{avoid:[],prefer:[]};
 const placementOfLogo=input.brief.art_direction?.logo_placement??'none';
 const logo=directed&&input.logo&&placementOfLogo!=='none'?input.logo:null;
 const prompt=buildImagePrompt({brief:input.brief,identity,references:manifest,hasParent:!!input.parent,textMode,artwork:input.artwork,frame,approvedDirection:approvedDirection(input.moodboard,input.prompt),
  ...(directed?{customerFeedback:feedback,logoComposited:!!logo}:{})});
 const render=async(provider:CreativeProvider,safetyIdentifier:string,override?:string):Promise<RenderedImage>=>{
  const output=await provider.image(input.model,override??prompt,size,input.quality,safetyIdentifier,input.parent?.bytes,references,fallbackSize);
  const resized=output.width===stored.width&&output.height===stored.height?{bytes:output.bytes,framing:null}:await toStored(output.bytes,placement&&target?placement:null,stored);
  const lockup=logo?await compositeLogo(resized.bytes,logo.bytes,placementOfLogo):null;
  const bytes=lockup?.bytes??resized.bytes,sha256=lockup?.sha256??digest(bytes);
  const kept=bytes!==output.bytes;
  return {bytes,sha256,width:stored.width,height:stored.height,usage:output.usage,created:output.created,framing:resized.framing,
   ...(kept?{source:{bytes:output.bytes,sha256:output.sha256}}:{}),
   ...(output.width!==stored.width?{master:{width:output.width,height:output.height,sha256:output.sha256}}:{}),
   ...(lockup?{logo:lockup.lockup}:{})};
 };
 return {prompt,size,...(fallbackSize?{fallbackSize}:{}),quality:input.quality,model:input.model,textMode,identity,references,manifest,target,placement,feedback,
  mustAvoid:feedback.avoid.map(a=>a.check),
  logo:logo?{source:logo.source,...(logo.reference_id?{reference_id:logo.reference_id}:{}),sha256:digest(logo.bytes),placement:placementOfLogo}:null,render};
}
