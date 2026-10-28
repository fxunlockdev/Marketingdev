/** Bundled, supported pairings. Persist the same value shown by Brand Kit. */
export const BRAND_FONT_PAIRINGS=[
 {id:'modern',name:'Modern',family:'DM Sans',value:'Headlines: DM Sans, weight 600. Body: DM Sans, weight 400.'},
 {id:'classic',name:'Classic',family:'DM Serif Display',value:'Headlines: DM Serif Display, weight 400. Body: DM Sans, weight 400.'},
 {id:'contrast',name:'Expressive',family:'DM Sans',value:'Headlines: DM Sans, weight 900. Body: DM Sans, weight 400.'},
] as const;
/** Only a recognized, unambiguous choice in the approved snapshot sets layer fonts.
 * Arbitrary scraped text remains model context, never executable font configuration. */
export function approvedBrandFont(facts:readonly {field:string;value:string}[]):typeof BRAND_FONT_PAIRINGS[number]['id']|undefined{
 const values=[...new Set(facts.filter(f=>f.field==='fonts').map(f=>f.value.trim()))];
 if(values.length!==1)return undefined;
 return BRAND_FONT_PAIRINGS.find(pair=>pair.value===values[0])?.id;
}
