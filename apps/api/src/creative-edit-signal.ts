/** What an owner changed in the Create canvas editor, as a bounded learning signal: text before/after for the
 * headline, body, call to action and caption, plus a short summary of layer changes (moved, resized, restyled,
 * added, removed) in the reason. Pure; nothing here is trusted as an instruction. */
import type {SignalDiff} from './learning-signals.js';

type Layer={id?:unknown;text?:unknown;x?:unknown;y?:unknown;width?:unknown;fontFamily?:unknown;fontSize?:unknown;fill?:unknown};
type Design={layers?:unknown};
export type EditSignal={diff:SignalDiff;reason:string;changed:boolean};
const TEXT_LAYERS=['headline','body','cta'] as const;
const MAX_REASON=1000,MAX_LAYER_NOTES=12;
const layersOf=(design:unknown):Layer[]=>{const layers=(design as Design|null)?.layers;return Array.isArray(layers)?layers.filter((l):l is Layer=>!!l&&typeof l==='object'):[];};
const label=(id:unknown):string=>String(id??'layer').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)||'layer';
const text=(value:unknown):string=>typeof value==='string'?value:'';

function layerNotes(before:Layer[],after:Layer[]):string[]{
 const old=new Map(before.map(l=>[String(l.id),l])),next=new Map(after.map(l=>[String(l.id),l]));
 const notes:string[]=[];
 for(const [id,layer] of next){
  const prior=old.get(id);
  if(!prior){notes.push(`added ${label(layer.id)}`);continue;}
  if(prior.x!==layer.x||prior.y!==layer.y)notes.push(`moved ${label(id)}`);
  if(prior.width!==layer.width||prior.fontSize!==layer.fontSize)notes.push(`resized ${label(id)}`);
  if(prior.fontFamily!==layer.fontFamily||prior.fill!==layer.fill)notes.push(`restyled ${label(id)}`);
 }
 for(const id of old.keys())if(!next.has(id))notes.push(`removed ${label(id)}`);
 return notes;
}

export function editSignal(before:{design:unknown;caption:unknown},after:{design:unknown;caption:unknown}):EditSignal{
 const oldLayers=layersOf(before.design),newLayers=layersOf(after.design);
 const find=(layers:Layer[],id:string):string=>text(layers.find(l=>l.id===id)?.text);
 const diff:SignalDiff={};
 for(const field of TEXT_LAYERS){const was=find(oldLayers,field),now=find(newLayers,field);if(was!==now)diff[field]={before:was.slice(0,500),after:now.slice(0,500)};}
 const oldCaption=text(before.caption),newCaption=text(after.caption);
 if(oldCaption!==newCaption)diff.caption={before:oldCaption.slice(0,500),after:newCaption.slice(0,500)};
 const notes=layerNotes(oldLayers,newLayers);
 const shown=notes.slice(0,MAX_LAYER_NOTES),more=notes.length-shown.length;
 const reason=notes.length?`Layer changes: ${shown.join(', ')}${more>0?` and ${more} more`:''}`.slice(0,MAX_REASON):'';
 return {diff,reason,changed:Object.keys(diff).length>0||notes.length>0};
}

/** Signal context known from a saved version's manifest: its layout and whether a stock photo fed it. */
export function manifestContext(manifest:unknown):{layout_archetype?:string;stock_used?:boolean}{
 const m=(manifest&&typeof manifest==='object'?manifest:{}) as {art_direction?:{layout_archetype?:unknown};references?:unknown};
 const layout=typeof m.art_direction?.layout_archetype==='string'?m.art_direction.layout_archetype:undefined;
 const stock=Array.isArray(m.references)?m.references.some(r=>typeof (r as {kind?:unknown})?.kind==='string'&&String((r as {kind:string}).kind).startsWith('stock_')):undefined;
 return {...(layout?{layout_archetype:layout}:{}),...(stock!==undefined?{stock_used:stock}:{})};
}
