import { BRAND_FONTS } from '../../api/src/brand-typography';

type FontLayer = {fontFamily:string;fontWeight?:number;text:string};
type FontLoader = Pick<FontFaceSet,'load'>;
/** Load each actual family/weight before Fabric measures or exports its text. */
export async function loadDesignFonts(layers:readonly FontLayer[], fonts:FontLoader=document.fonts, timeoutMs=15000):Promise<void>{
 const grouped=new Map<string,FontLayer>();
 for(const layer of layers.filter(layer=>layer.text.trim())){const key=`${layer.fontFamily}:${layer.fontWeight??400}`,previous=grouped.get(key);grouped.set(key,{...layer,text:previous?previous.text+' '+layer.text:layer.text});}
 const requests=[...grouped.values()];
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([
   Promise.all(requests.map(async layer=>{
    const faces=await fonts.load(`${layer.fontWeight??400} 16px "${layer.fontFamily}"`,layer.text);
    if(BRAND_FONTS.some(font=>font.family===layer.fontFamily)&&faces.length===0)throw new Error(`The ${layer.fontFamily} font could not be loaded. Retry fonts before downloading.`);
   })),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Fonts took too long to load. Retry fonts before downloading.')),timeoutMs);}),
  ]);
 }finally{if(timer)clearTimeout(timer);}
}
