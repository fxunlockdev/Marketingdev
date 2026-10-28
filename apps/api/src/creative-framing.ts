import sharp from 'sharp';
import {digest} from './object-store.js';
import {creativeDimensions,type CreativeSpec} from './campaign-formats.js';
/** Fit the full generated image into the chosen placement without cropping or distortion. */
export async function frameCreative(bytes:Buffer,spec:CreativeSpec){
 const target=creativeDimensions(spec);
 const metadata=await sharp(bytes,{limitInputPixels:24_000_000}).metadata();
 if(!metadata.width||!metadata.height)throw new Error('CREATIVE_FRAMING_INVALID');
 if(metadata.width===target.width&&metadata.height===target.height)return {bytes,sha256:digest(bytes),...target,framing:null};
 const output=await sharp(bytes,{limitInputPixels:24_000_000}).resize(target.width,target.height,{fit:'contain',background:'#ffffff'}).png().toBuffer();
 return {bytes:output,sha256:digest(output),...target,framing:{mode:'contain',source_sha256:digest(bytes),source_width:metadata.width,source_height:metadata.height,...target}};
}
