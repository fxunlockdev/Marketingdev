import {BRAND_FONTS,type BrandFontFamily,type BrandTypography,type FontWeight} from './brand-typography.js';
import {LAYOUT_ARCHETYPES,type LayoutArchetype} from './image-art-direction.js';
import {lookStyle,onboardingLook,type LookPalette} from './look-styles.js';
import type {PostArtwork} from './post-artwork.js';

/** A business's creative direction for social posts: the looks the owner picked, plus the
 * researched voice. Stored as immutable versions; generators read the latest one. Pure module,
 * shared by the API and the web app. */
export type BrandDirectionLook={id:string;name:string;src:string};
export type BrandDirection={
 looks:BrandDirectionLook[];
 palette:LookPalette;
 heading_font:BrandFontFamily;heading_weight:FontWeight;
 body_font:BrandFontFamily;body_weight:FontWeight;
 layout_archetype:LayoutArchetype;
 /** The primary layout first, then layouts the other looks add for variety. */
 layout_variety:LayoutArchetype[];
 headline_treatment:string;
 imagery:string;
 /** Imagery the other picked looks add for variety. */
 imagery_variety:string[];
 tone:string;
 voice:string;
 summary:string;
 pillars:string[];
 /** The owner's own words about their look or tone. */
 notes:string;
};
/** The researched direction (business-research-direction.ts), or a legacy mood board direction. */
export type ResearchedDirection={summary?:unknown;voice?:unknown;imagery?:unknown;pillars?:unknown;palette?:unknown;heading_font?:unknown;body_font?:unknown};
export type BrandDirectionEdit={looks:string[];palette:LookPalette;heading_font:string;heading_weight:number;body_font:string;body_weight:number};

export const MAX_LOOKS=3;
export const PALETTE_ROLES=['dominant','headline','accent','background'] as const;
const LIMITS={headline_treatment:300,imagery:800,imagery_variety:400,tone:200,voice:400,summary:800,pillar:250,notes:800} as const;
const HEX=/^#[0-9a-f]{6}$/i;
const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FALLBACK_TREATMENT='A short headline in the heading font and headline colour, with strong contrast and generous space around it.';
const KEYS=['looks','palette','heading_font','heading_weight','body_font','body_weight','layout_archetype','layout_variety','headline_treatment','imagery','imagery_variety','tone','voice','summary','pillars','notes'] as const;

export class BrandDirectionError extends Error{}

const clean=(value:unknown,max:number):string=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const sentence=(value:string,max:number):string=>value.length<=max?value:value.slice(0,max-1).trimEnd()+'…';

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a:string,b:string):number{
 const luminance=(hex:string):number=>{
  const [r,g,b2]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*r+0.7152*g+0.0722*b2;
 };
 const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);
 return (x+0.05)/(y+0.05);
}

function fontWeight(family:string,wanted:number):FontWeight{
 const weights=BRAND_FONTS.find(f=>f.family===family)?.weights as readonly FontWeight[]|undefined;
 if(!weights)throw new BrandDirectionError('Choose fonts from the list');
 return weights.includes(wanted as FontWeight)?wanted as FontWeight:weights.reduce((best,w)=>Math.abs(w-wanted)<Math.abs(best-wanted)?w:best);
}
const brandFont=(value:unknown):BrandFontFamily|undefined=>BRAND_FONTS.find(f=>f.family===value)?.family;

function lookList(ids:readonly unknown[]):BrandDirectionLook[]{
 if(!Array.isArray(ids)||ids.length>MAX_LOOKS||new Set(ids).size!==ids.length)throw new BrandDirectionError('Choose up to three different looks');
 return ids.map(id=>{const r=typeof id==='string'?onboardingLook(id):undefined;if(!r||!lookStyle(r.id))throw new BrandDirectionError('Choose looks from the gallery');return {id:r.id,name:r.name,src:r.src};});
}

function researchPalette(palette:unknown):LookPalette|undefined{
 if(!Array.isArray(palette))return undefined;
 const hex=(role:string)=>{const c=palette.find(p=>p&&typeof p==='object'&&(p as {role?:unknown}).role===role) as {hex?:unknown}|undefined;return typeof c?.hex==='string'&&HEX.test(c.hex)?c.hex.toLowerCase():undefined;};
 const primary=hex('primary'),secondary=hex('secondary'),accent=hex('accent');
 if(!primary||!secondary||!accent)return undefined;
 const headline=contrastRatio(primary,secondary)>=4.5?primary:contrastRatio('#ffffff',secondary)>=contrastRatio('#111111',secondary)?'#ffffff':'#111111';
 return {dominant:primary,headline,accent,background:secondary};
}

/** Researched voice, summary and pillars; never the look's visual choices. */
function researchedVoice(research:ResearchedDirection|null|undefined):Pick<BrandDirection,'voice'|'summary'|'pillars'>{
 const pillars=Array.isArray(research?.pillars)?research.pillars.map(p=>clean(p,LIMITS.pillar)).filter(Boolean).slice(0,5):[];
 return {voice:clean(research?.voice,LIMITS.voice),summary:clean(research?.summary,LIMITS.summary),pillars};
}

/** The picked looks become the direction: the first is primary, the others add imagery and layout variety. */
export function directionFromLooks(ids:readonly string[],research:ResearchedDirection|null|undefined,notes=''):BrandDirection{
 const looks=lookList(ids);
 if(!looks.length)throw new BrandDirectionError('Choose at least one look');
 const styles=looks.map(l=>lookStyle(l.id)!),primary=styles[0];
 return {looks,palette:{...primary.palette},heading_font:primary.heading_font,heading_weight:primary.heading_weight,body_font:primary.body_font,body_weight:primary.body_weight,
  layout_archetype:primary.layout_archetype,layout_variety:[...new Set(styles.map(s=>s.layout_archetype))],
  headline_treatment:primary.headline_treatment,imagery:primary.imagery,imagery_variety:styles.slice(1).map(s=>sentence(s.imagery,LIMITS.imagery_variety)),
  tone:primary.tone,...researchedVoice(research),notes:clean(notes,LIMITS.notes)};
}

/** No look picked: the researched direction is used directly, without preview images. */
export function directionFromResearch(research:ResearchedDirection|null|undefined,notes=''):BrandDirection{
 const palette=researchPalette(research?.palette),heading=brandFont(research?.heading_font),body=brandFont(research?.body_font);
 if(!palette||!heading||!body)throw new BrandDirectionError('Wait for your business research to finish, or pick a look');
 const voice=researchedVoice(research);
 return {looks:[],palette,heading_font:heading,heading_weight:fontWeight(heading,700),body_font:body,body_weight:fontWeight(body,400),
  layout_archetype:'lifestyle_hero',layout_variety:['lifestyle_hero'],headline_treatment:FALLBACK_TREATMENT,
  imagery:clean(research?.imagery,LIMITS.imagery)||'Real, specific photography of the business in natural light.',imagery_variety:[],
  tone:sentence(voice.voice||'Clear and welcoming.',LIMITS.tone),...voice,notes:clean(notes,LIMITS.notes)};
}

export function onboardingDirection(ids:readonly string[],research:ResearchedDirection|null|undefined,notes=''):BrandDirection{
 return ids.length?directionFromLooks(ids,research,notes):directionFromResearch(research,notes);
}

/** A Brand Kit edit: new looks reset the visual choices to the new primary look, then the owner's
 * colour and font choices are applied. Voice, summary, pillars and notes carry over. */
export function brandKitDirection(previous:BrandDirection|null,edit:BrandDirectionEdit):BrandDirection{
 const same=!!previous&&previous.looks.map(l=>l.id).join('|')===edit.looks.join('|');
 const carried={voice:previous?.voice??'',summary:previous?.summary??'',pillars:previous?.pillars??[]};
 const base=same?previous:edit.looks.length?{...directionFromLooks(edit.looks,carried,previous?.notes??'')}:previous;
 if(!base)throw new BrandDirectionError('Choose at least one look');
 const heading=brandFont(edit.heading_font),body=brandFont(edit.body_font);
 if(!heading||!body)throw new BrandDirectionError('Choose fonts from the list');
 return validateBrandDirection({...base,palette:edit.palette,heading_font:heading,heading_weight:fontWeight(heading,edit.heading_weight),body_font:body,body_weight:fontWeight(body,edit.body_weight)});
}

const text=(value:unknown,max:number,required:boolean):boolean=>typeof value==='string'&&value.length<=max&&!CONTROL.test(value)&&(!required||value.trim().length>0);
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const weightOk=(family:unknown,weight:unknown):boolean=>BRAND_FONTS.some(f=>f.family===family&&(f.weights as readonly number[]).includes(Number(weight)));

/** Strict check for stored and edited directions. Returns a copy holding only known fields. */
export function validateBrandDirection(value:unknown):BrandDirection{
 const fail=():never=>{throw new BrandDirectionError('Check your creative direction');};
 if(!exact(value,KEYS))return fail();
 const v=value as BrandDirection;
 if(!Array.isArray(v.looks))return fail();
 const looks=lookList(v.looks.map(l=>exact(l,['id','name','src'])?l.id:null));
 if(!exact(v.palette,PALETTE_ROLES)||PALETTE_ROLES.some(role=>typeof v.palette[role]!=='string'||!HEX.test(v.palette[role])))return fail();
 if(!weightOk(v.heading_font,v.heading_weight)||!weightOk(v.body_font,v.body_weight))throw new BrandDirectionError('Choose fonts from the list');
 if(!LAYOUT_ARCHETYPES.includes(v.layout_archetype)||!Array.isArray(v.layout_variety)||!v.layout_variety.length||v.layout_variety.length>MAX_LOOKS||v.layout_variety[0]!==v.layout_archetype||new Set(v.layout_variety).size!==v.layout_variety.length||v.layout_variety.some(a=>!LAYOUT_ARCHETYPES.includes(a)))return fail();
 if(!text(v.headline_treatment,LIMITS.headline_treatment,true)||!text(v.imagery,LIMITS.imagery,true)||!text(v.tone,LIMITS.tone,true)||!text(v.voice,LIMITS.voice,false)||!text(v.summary,LIMITS.summary,false)||!text(v.notes,LIMITS.notes,false))return fail();
 if(!Array.isArray(v.imagery_variety)||v.imagery_variety.length>MAX_LOOKS-1||v.imagery_variety.some(i=>!text(i,LIMITS.imagery_variety,true)))return fail();
 if(!Array.isArray(v.pillars)||v.pillars.length>5||v.pillars.some(p=>!text(p,LIMITS.pillar,true)))return fail();
 return {looks,palette:{dominant:v.palette.dominant.toLowerCase(),headline:v.palette.headline.toLowerCase(),accent:v.palette.accent.toLowerCase(),background:v.palette.background.toLowerCase()},
  heading_font:v.heading_font,heading_weight:v.heading_weight,body_font:v.body_font,body_weight:v.body_weight,layout_archetype:v.layout_archetype,layout_variety:[...v.layout_variety],
  headline_treatment:v.headline_treatment,imagery:v.imagery,imagery_variety:[...v.imagery_variety],tone:v.tone,voice:v.voice,summary:v.summary,pillars:[...v.pillars],notes:v.notes};
}

/** Bounded, plain-data block for planner and image prompts. Never instructions. */
export function directionPromptBlock(d:BrandDirection,detail:'full'|'short'='full'):Record<string,unknown>{
 const short=detail==='short';
 return {
  palette_roles:{...d.palette},
  heading_font:`${d.heading_font} ${d.heading_weight}`,body_font:`${d.body_font} ${d.body_weight}`,
  layout_archetype:d.layout_archetype,
  ...(d.layout_variety.length>1?{layout_variety:d.layout_variety.slice(1)}:{}),
  headline_treatment:d.headline_treatment.slice(0,short?160:300),
  imagery:d.imagery.slice(0,short?240:600),
  ...(!short&&d.imagery_variety.length?{imagery_variety:d.imagery_variety.map(i=>i.slice(0,240))}:{}),
  tone:d.tone,
  ...(d.voice?{voice:d.voice.slice(0,short?120:240)}:{}),
  ...(!short&&d.notes?{owner_notes:d.notes.slice(0,300)}:{}),
 };
}

/** Planned posts use the direction's fonts and weights for their editable type. */
export function directionTypography(d:Pick<BrandDirection,'heading_font'|'heading_weight'|'body_font'|'body_weight'>):PostArtwork{
 const typography:BrandTypography={headline:{family:d.heading_font,weight:fontWeight(d.heading_font,d.heading_weight)},body:{family:d.body_font,weight:fontWeight(d.body_font,d.body_weight)}};
 return {text:'headline',typography};
}

/** The campaign theme the monthly planner receives. */
export function directionPlanningTheme(d:BrandDirection):string{
 const p=d.palette;
 return `Creative direction (owner-chosen looks${d.looks.length?`: ${d.looks.map(l=>l.name).join(', ')}`:''}). Palette: dominant ${p.dominant}, headline ${p.headline}, accent ${p.accent}, background ${p.background}. Fonts: ${d.heading_font} ${d.heading_weight} headings, ${d.body_font} body. Layouts: ${d.layout_variety.join(', ').replaceAll('_',' ')}. Headlines: ${d.headline_treatment.slice(0,200)} Imagery: ${d.imagery.slice(0,250)} Tone: ${d.tone}${d.voice?` Voice: ${d.voice.slice(0,100)}`:''}`.slice(0,1200);
}
