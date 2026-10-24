import sharp from 'sharp';
import {digest,InvalidAsset} from './object-store.js';
export async function normalizeProductPhoto(bytes:Buffer){
 try{
  const {data,info}=await sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}).rotate().flatten({background:'#ffffff'}).resize({width:3072,height:3072,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer({resolveWithObject:true});
  if(data.length>6*1024*1024)throw new Error('Oversized normalized photo');
  return {data,width:info.width,height:info.height,bytes:data.length,sha256:digest(data)};
 }catch{throw new InvalidAsset('INVALID_IMAGE');}
}
