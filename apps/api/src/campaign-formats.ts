/** Shared pure format vocabulary. Missing specifications are legacy, never inferred. */
export type CreativeSpec={placement:'feed'|'story'|'reel';aspect:'square'|'portrait'|'landscape'|'vertical';slide_count:number|null};
export function normalizeCreativeSpec(value:unknown,format:string,channel:string):CreativeSpec{
 const invalid=()=>{throw Object.assign(new Error('Choose a compatible post placement, aspect and slide count'),{code:'CAMPAIGN_FORMAT_INVALID'});};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).sort().join(',')!=='aspect,placement,slide_count'||!['static','ad','video','carousel'].includes(format)||!['instagram','facebook','linkedin'].includes(channel))return invalid();
 if(!['feed','story','reel'].includes(String(v.placement))||!['square','portrait','landscape','vertical'].includes(String(v.aspect)))return invalid();
 if(v.placement==='feed'?(v.aspect==='vertical'):(v.aspect!=='vertical'||channel==='linkedin'||format==='ad'||format==='carousel'))return invalid();
 if(v.placement==='reel'&&format!=='video')return invalid();
 if(format==='carousel'?!Number.isInteger(v.slide_count)||Number(v.slide_count)<2||Number(v.slide_count)>10:v.slide_count!==null)return invalid();
 return {placement:v.placement as CreativeSpec['placement'],aspect:v.aspect as CreativeSpec['aspect'],slide_count:v.slide_count as number|null};
}
export function creativeDimensions(spec:CreativeSpec):{width:number;height:number}{
 return {square:{width:1024,height:1024},portrait:{width:1024,height:1536},landscape:{width:1536,height:1024},vertical:{width:1080,height:1920}}[spec.aspect];
}
export function creativeSourceSize(spec:CreativeSpec):'1024x1024'|'1024x1536'|'1536x1024'{
 return spec.aspect==='square'?'1024x1024':spec.aspect==='landscape'?'1536x1024':'1024x1536';
}
