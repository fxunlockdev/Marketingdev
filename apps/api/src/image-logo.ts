/** Deterministic logo lockup: the approved logo file, never a model's redraw, placed at the art
 * direction's corner of the finished creative. Brand Engine: "Never accept a regenerated logo as the
 * final brand mark." Pure image processing; the same inputs always give the same bytes. */
import sharp,{type OverlayOptions} from 'sharp';
import type {LogoPlacement} from './image-art-direction.js';
import {digest} from './object-store.js';

export type LogoBox={left:number;top:number;width:number;height:number};
export type LogoLockup={placement:Exclude<LogoPlacement,'none'>;box:LogoBox;logo_sha256:string;chip:boolean};
/** Logo width as a share of the creative's width, and its height cap as a share of the height. */
const WIDTH_SHARE=0.2,HEIGHT_SHARE=0.085,MARGIN_SHARE=0.055;
/** A story's top 14% and bottom 20% sit under the app interface (creative-framing.ts). */
const STORY_TOP=0.14,STORY_BOTTOM=0.2;
const WHITE=232,SOFT=200;

/** Approved logos are stored as JPEG on a white ground. Make near-white transparent and trim. */
export async function logoCutout(logo:Buffer):Promise<{data:Buffer;width:number;height:number;luminance:number}>{
 const {data,info}=await sharp(logo,{limitInputPixels:24_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const corners=[0,info.width-1,(info.height-1)*info.width,info.height*info.width-1].map(i=>Math.min(data[i*4],data[i*4+1],data[i*4+2]));
 const keyed=Buffer.from(data);
 let sum=0,count=0;
 if(corners.every(c=>c>=WHITE)){
  for(let i=0;i<keyed.length;i+=4){
   const low=Math.min(keyed[i],keyed[i+1],keyed[i+2]);
   keyed[i+3]=low>=WHITE?0:low>SOFT?Math.round(255*(WHITE-low)/(WHITE-SOFT)):keyed[i+3];
  }
 }
 for(let i=0;i<keyed.length;i+=4)if(keyed[i+3]>128){sum+=0.2126*keyed[i]+0.7152*keyed[i+1]+0.0722*keyed[i+2];count++;}
 const trimmed=await sharp(keyed,{raw:{width:info.width,height:info.height,channels:4}}).trim({threshold:1}).png().toBuffer({resolveWithObject:true});
 return {data:trimmed.data,width:trimmed.info.width,height:trimmed.info.height,luminance:count?sum/count/255:0};
}

function box(canvas:{width:number;height:number},logo:{width:number;height:number},placement:LogoLockup['placement']):LogoBox{
 const story=canvas.height/canvas.width>1.7;
 const scale=Math.min(canvas.width*WIDTH_SHARE/logo.width,canvas.height*HEIGHT_SHARE/logo.height);
 const width=Math.max(1,Math.round(logo.width*scale)),height=Math.max(1,Math.round(logo.height*scale));
 const margin=Math.round(Math.min(canvas.width,canvas.height)*MARGIN_SHARE);
 const top=story?Math.round(canvas.height*STORY_TOP)+margin/2:margin,bottom=canvas.height-height-(story?Math.round(canvas.height*STORY_BOTTOM)+margin/2:margin);
 const left=placement.endsWith('left')?margin:placement.endsWith('right')?canvas.width-width-margin:Math.round((canvas.width-width)/2);
 return {left:Math.round(left),top:Math.round(placement.startsWith('top')?top:bottom),width,height};
}

async function regionLuminance(image:Buffer,area:LogoBox):Promise<number>{
 const stats=await sharp(image,{limitInputPixels:24_000_000}).extract(area).removeAlpha().stats();
 const [r,g,b]=stats.channels.map(c=>c.mean);
 return (0.2126*r+0.7152*g+0.0722*b)/255;
}

/** Composite the approved logo. When the corner is too close in tone to the logo, a soft chip of the
 * opposite tone sits behind it so the mark stays legible. */
export async function compositeLogo(image:Buffer,logo:Buffer,placement:LogoPlacement):Promise<{bytes:Buffer;sha256:string;lockup:LogoLockup}|null>{
 if(placement==='none')return null;
 const meta=await sharp(image,{limitInputPixels:24_000_000}).metadata();
 if(!meta.width||!meta.height)throw new Error('LOGO_CANVAS_INVALID');
 const cut=await logoCutout(logo),area=box({width:meta.width,height:meta.height},cut,placement);
 const behind=await regionLuminance(image,area),chip=Math.abs(behind-cut.luminance)<0.35;
 const mark=await sharp(cut.data).resize(area.width,area.height,{fit:'fill'}).png().toBuffer();
 const pad=Math.round(area.height*0.35),tone=cut.luminance>0.5?'#111111':'#ffffff';
 const layers:OverlayOptions[]=[];
 if(chip){
  const w=area.width+pad*2,h=area.height+pad*2;
  layers.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${Math.round(h/2)}" fill="${tone}" fill-opacity="0.82"/></svg>`),left:Math.max(0,area.left-pad),top:Math.max(0,area.top-pad)});
 }
 layers.push({input:mark,left:area.left,top:area.top});
 const bytes=await sharp(image,{limitInputPixels:24_000_000}).composite(layers).png().toBuffer();
 return {bytes,sha256:digest(bytes),lockup:{placement,box:area,logo_sha256:digest(logo),chip}};
}

/** A brand reference is the logo when its approved label says so. */
export function isLogoLabel(label:string):boolean{
 return /\blogo(type|mark)?s?\b|\bwordmark\b/i.test(label);
}
