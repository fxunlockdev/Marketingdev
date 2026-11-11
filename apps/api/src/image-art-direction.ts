/** Structured art direction that the brief planner decides and the image prompt follows.
 *
 * A brief written before this existed has no art direction. It stays valid and keeps the
 * earlier behaviour: text is added afterwards as editable overlay layers.
 */
export const LAYOUT_ARCHETYPES=['lifestyle_hero','product_hero','type_led_poster','comparison','offer','quote'] as const;
export const TEXT_MODES=['in_image','overlay','none'] as const;
export const LOGO_PLACEMENTS=['none','top_left','top_right','bottom_left','bottom_right','bottom_center'] as const;
export type LayoutArchetype=typeof LAYOUT_ARCHETYPES[number];
export type TextMode=typeof TEXT_MODES[number];
export type LogoPlacement=typeof LOGO_PLACEMENTS[number];
export type PaletteRoles={dominant:string;headline:string;accent:string};
export type ArtDirection={
 layout_archetype:LayoutArchetype;
 /** in_image: the model sets the headline as designed type. overlay: editable layers. none: no text. */
 text_mode:TextMode;
 headline_treatment:string;
 hierarchy:string;
 composition:string;
 lighting:string;
 palette_roles:PaletteRoles;
 product_placement:string;
 logo_placement:LogoPlacement;
};

const TEXT_LIMITS={headline_treatment:300,hierarchy:300,composition:600,lighting:300,product_placement:400} as const;
const PALETTE_KEYS=['dominant','headline','accent'] as const;
const FIELDS=['layout_archetype','text_mode','headline_treatment','hierarchy','composition','lighting','palette_roles','product_placement','logo_placement'] as const;
const HEX=/^#[0-9a-f]{6}$/i;
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const exactKeys=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>
 !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const includes=(list:readonly string[],value:unknown):boolean=>typeof value==='string'&&list.includes(value);

export function validTextMode(value:unknown):value is TextMode{
 return includes(TEXT_MODES,value);
}

export function validArtDirection(value:unknown):value is ArtDirection{
 if(!exactKeys(value,FIELDS))return false;
 if(!includes(LAYOUT_ARCHETYPES,value.layout_archetype)||!validTextMode(value.text_mode)||!includes(LOGO_PLACEMENTS,value.logo_placement))return false;
 for(const [field,max] of Object.entries(TEXT_LIMITS)){
  const text=value[field];
  if(typeof text!=='string'||!text.trim()||text.length>max||CONTROL.test(text))return false;
 }
 const roles=value.palette_roles;
 return exactKeys(roles,PALETTE_KEYS)&&PALETTE_KEYS.every(key=>typeof roles[key]==='string'&&HEX.test(roles[key] as string));
}

/** Strict structured-output schema: every field is required so the planner cannot skip direction. */
export function artDirectionSchema():Record<string,unknown>{
 const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
 const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
 const properties={
  layout_archetype:{type:'string',enum:[...LAYOUT_ARCHETYPES]},
  text_mode:{type:'string',enum:[...TEXT_MODES]},
  headline_treatment:text(TEXT_LIMITS.headline_treatment),
  hierarchy:text(TEXT_LIMITS.hierarchy),
  composition:text(TEXT_LIMITS.composition),
  lighting:text(TEXT_LIMITS.lighting),
  palette_roles:{type:'object',additionalProperties:false,properties:{dominant:hex,headline:hex,accent:hex},required:[...PALETTE_KEYS]},
  product_placement:text(TEXT_LIMITS.product_placement),
  logo_placement:{type:'string',enum:[...LOGO_PLACEMENTS]},
 };
 return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}

/** Scenes carry a short designed headline; dense or comparative layouts stay editable. */
export function defaultTextMode(archetype:LayoutArchetype):TextMode{
 return archetype==='lifestyle_hero'||archetype==='product_hero'?'in_image':'overlay';
}
