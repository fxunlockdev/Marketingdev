import type {PlanningReference} from './planning-references.js';

/** Labels the image engine treats as a logo (kept in step with migration 140's logo policy). */
const LOGO_LABEL=/\b(logo|wordmark)/i;
const STOP=new Set(['the','and','for','with','your','our','you','this','that','from','into','are','its','new','all','get','one','day','post','image','photo','picture']);
const OFFER_FIELDS=new Set(['offering','products','product','services','offer']);

type SlotLike={format:string;brief?:string;hook?:string;reference_ids?:string[];storyline?:unknown};
type Fact={field:string;value:unknown};

function words(text:string):Set<string>{
 return new Set(text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).map(w=>w.replace(/s$/,'')).filter(w=>w.length>=3&&!STOP.has(w)));
}
function typeLed(storyline:unknown):boolean{
 return !!storyline&&typeof storyline==='object'&&(storyline as {layout_archetype?:unknown}).layout_archetype==='type_led_poster';
}

/** The one approved product photo to attach to a static post whose planner chose no reference, or null.
 * Ranked by label words shared with the post's brief, hook and the business's offer; a photo that shares no
 * word is never attached, so one photo is not pasted onto every post. Never a logo, never more than one, never
 * for type-led art direction. Pure. */
export function productPhotoFor(slot:SlotLike,references:readonly PlanningReference[],offer:string):string|null{
 if(slot.format!=='static'||(slot.reference_ids?.length??0)>0||typeLed(slot.storyline))return null;
 const wanted=words(`${slot.brief??''} ${slot.hook??''} ${offer}`);
 let best:{id:string;score:number}|null=null;
 for(const reference of references){
  if(LOGO_LABEL.test(reference.label))continue;
  const score=[...words(reference.label)].filter(w=>wanted.has(w)).length;
  if(score===0)continue;
  if(!best||score>best.score)best={id:reference.id,score};
 }
 return best?.id??null;
}

/** The plan's slots with a product photo added where the planner chose none. Returns new slot objects. */
export function withProductPhotos<T extends SlotLike>(slots:readonly T[],references:readonly PlanningReference[]|undefined,facts:readonly Fact[]):T[]{
 if(!references?.length)return [...slots];
 const offer=facts.filter(f=>OFFER_FIELDS.has(f.field)).map(f=>String(f.value)).join(' ');
 return slots.map(slot=>{const id=productPhotoFor(slot,references,offer);return id?{...slot,reference_ids:[id]}:slot;});
}
