/** The self-hosted font catalog shared by brand settings, generation and the editor. */
export const BRAND_FONTS = [
 {family:'DM Sans',weights:[100,200,300,400,500,600,700,800,900]},
 {family:'DM Serif Display',weights:[400]},
 {family:'Playfair Display',weights:[400,500,600,700,800,900]},
 {family:'Montserrat',weights:[100,200,300,400,500,600,700,800,900]},
 {family:'Lora',weights:[400,500,600,700]},
 {family:'Oswald',weights:[200,300,400,500,600,700]},
] as const;
export type BrandFontFamily=typeof BRAND_FONTS[number]['family'];
export type FontWeight=100|200|300|400|500|600|700|800|900;
export type BrandTypography={headline:{family:BrandFontFamily;weight:FontWeight};body:{family:BrandFontFamily;weight:FontWeight}};
export const DESIGN_FONT_FAMILIES=['Arial','Georgia','Verdana',...BRAND_FONTS.map(font=>font.family)] as const;
export type DesignFontFamily=typeof DESIGN_FONT_FAMILIES[number];
/** Historical designs used bold DM Serif Display; keep those saved documents readable. */
export function designFontWeights(family:string):readonly number[]{
 if(family==='DM Serif Display')return [400,700];
 return BRAND_FONTS.find(font=>font.family===family)?.weights??(['Arial','Georgia','Verdana'].includes(family)?[400,700]:[]);
}
export function validBrandTypography(value:unknown):value is BrandTypography{
 const typography=value as BrandTypography|undefined;
 return !!typography&&[typography.headline,typography.body].every(part=>!!part&&BRAND_FONTS.some(font=>font.family===part.family&&(font.weights as readonly number[]).includes(part.weight)));
}
export function serializeBrandTypography(value:BrandTypography):string{
 if(!validBrandTypography(value))throw new Error('Unsupported brand typography');
 return `Headlines: ${value.headline.family}, weight ${value.headline.weight}. Body: ${value.body.family}, weight ${value.body.weight}.`;
}
/** Only this exact bounded format becomes executable font configuration. */
export function parseBrandTypography(value:string):BrandTypography|undefined{
 const match=/^Headlines: ([A-Za-z ]{1,40}), weight ([1-9]00)\. Body: ([A-Za-z ]{1,40}), weight ([1-9]00)\.$/.exec(value);
 if(!match)return undefined;
 const typography={headline:{family:match[1],weight:Number(match[2])},body:{family:match[3],weight:Number(match[4])}};
 return validBrandTypography(typography)?typography:undefined;
}
/** Preserve the values already stored by earlier versions of Brand Kit. */
export const BRAND_FONT_PAIRINGS=[
 {id:'modern',name:'Modern',family:'DM Sans',value:'Headlines: DM Sans, weight 600. Body: DM Sans, weight 400.'},
 {id:'classic',name:'Classic',family:'DM Serif Display',value:'Headlines: DM Serif Display, weight 400. Body: DM Sans, weight 400.'},
 {id:'contrast',name:'Expressive',family:'DM Sans',value:'Headlines: DM Sans, weight 900. Body: DM Sans, weight 400.'},
 {id:'editorial',name:'Editorial',family:'Playfair Display',value:'Headlines: Playfair Display, weight 600. Body: Montserrat, weight 400.'},
 {id:'geometric',name:'Geometric',family:'Montserrat',value:'Headlines: Montserrat, weight 700. Body: DM Sans, weight 400.'},
 {id:'literary',name:'Literary',family:'Lora',value:'Headlines: Lora, weight 500. Body: DM Sans, weight 400.'},
 {id:'impact',name:'Impact',family:'Oswald',value:'Headlines: Oswald, weight 600. Body: Montserrat, weight 400.'},
] as const;
export type BrandFontPreset=typeof BRAND_FONT_PAIRINGS[number]['id'];
export function resolveBrandTypography(value:BrandFontPreset|BrandTypography|undefined):BrandTypography|undefined{
 if(typeof value==='string'){const pair=BRAND_FONT_PAIRINGS.find(pair=>pair.id===value);return pair?parseBrandTypography(pair.value):undefined;}
 return validBrandTypography(value)?value:undefined;
}
/** Ambiguous or arbitrary scraped text remains context, never font configuration. */
export function approvedBrandFont(facts:readonly {field:string;value:string}[]):BrandFontPreset|BrandTypography|undefined{
 const values=[...new Set(facts.filter(f=>f.field==='fonts').map(f=>f.value.trim()))];
 if(values.length!==1)return undefined;
 return BRAND_FONT_PAIRINGS.find(pair=>pair.value===values[0])?.id??parseBrandTypography(values[0]);
}
