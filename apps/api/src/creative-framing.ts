import sharp from 'sharp';
import {digest} from './object-store.js';
import {creativeDimensions,creativeSourceSize,type CreativeSpec} from './campaign-formats.js';

export type Size={width:number;height:number};
export type Crop={left:number;top:number;width:number;height:number};
/** cover: fill the placement and trim the overflow. contain: keep every pixel and pad with white. */
export type FramingMode='cover'|'contain';
export type Framing={mode:FramingMode;source_sha256:string;source_width:number;source_height:number;width:number;height:number;crop?:Crop};
export type FramedCreative=Size&{bytes:Buffer;sha256:string;framing:Framing|null};

/** The centred region of the source that survives when it is scaled to fill the target. */
export function coverCrop(source:Size,target:Size):Crop{
 const scale=Math.max(target.width/source.width,target.height/source.height);
 const width=Math.min(source.width,Math.round(target.width/scale)),height=Math.min(source.height,Math.round(target.height/scale));
 return {left:Math.floor((source.width-width)/2),top:Math.floor((source.height-height)/2),width,height};
}

/** Compose the generated image at the placement's true size. By default it fills the frame
 * edge to edge; the provider's original bytes are kept by the caller for provenance. */
export async function frameCreative(bytes:Buffer,spec:CreativeSpec,mode:FramingMode='cover',target:Size=creativeDimensions(spec)):Promise<FramedCreative>{
 const metadata=await sharp(bytes,{limitInputPixels:24_000_000}).metadata();
 if(!metadata.width||!metadata.height)throw new Error('CREATIVE_FRAMING_INVALID');
 if(metadata.width===target.width&&metadata.height===target.height)return {bytes,sha256:digest(bytes),...target,framing:null};
 const source={width:metadata.width,height:metadata.height};
 const output=await sharp(bytes,{limitInputPixels:24_000_000}).resize(target.width,target.height,mode==='cover'?{fit:'cover',position:'centre'}:{fit:'contain',background:'#ffffff'}).png().toBuffer();
 return {bytes:output,sha256:digest(output),...target,framing:{mode,source_sha256:digest(bytes),source_width:source.width,source_height:source.height,...target,...(mode==='cover'?{crop:coverCrop(source,target)}:{})}};
}

const percent=(fraction:number):number=>Math.ceil(fraction*100);

/** Tells the image model what will be trimmed, so nothing important sits in the lost margin.
 * Undefined when the provider size already matches the placement. */
export function frameDirection(spec:CreativeSpec,target:Size=creativeDimensions(spec)):string|undefined{
 const [width,height]=creativeSourceSize(spec).split('x').map(Number),source={width,height};
 const crop=coverCrop(source,target),sides=(width-crop.width)/2/width,ends=(height-crop.height)/2/height;
 if(sides===0&&ends===0)return undefined;
 // Two points of extra margin so type never touches the cut edge.
 const lost=(fraction:number)=>percent(fraction)+2;
 const trims=[
  ...(sides>0?[`about ${percent(sides)}% is cut from the left and from the right, so keep every word, face, product and logo inside the central ${100-2*lost(sides)}% of the width`]:[]),
  ...(ends>0?[`about ${percent(ends)}% is cut from the top and from the bottom, so keep every word, face, product and logo inside the central ${100-2*lost(ends)}% of the height`]:[]),
 ];
 return [
  `The finished post is ${target.width}x${target.height} and is cropped from this canvas to fill it: ${trims.join('; ')}.`,
  'Fill the whole canvas with the scene, edge to edge. No borders, bars, frames or blank bands.',
  ...(spec.placement==='feed'?[]:['This is a full-screen vertical story: also keep the headline, call to action and logo out of the top 14% and bottom 20%, where the app interface sits.']),
 ].join(' ');
}
