"use client";
import {Field} from './primitives';
import {DesvioSelect} from './desvio-select';
import './creative-brief.css';
export type CreativeBriefValue={markets?:string;languages?:string;timing?:string;direction?:string};
const directions=[
 ['cinematic','Cinematic Editorial','Cinematic light, considered framing and an editorial feel.'],
 ['gallery','Object Gallery','Clean product compositions with generous space and precise details.'],
 ['poster','Product Poster','Bold product-led compositions with a clear focal point.'],
 ['documentary','People First','Natural moments, real people and a documentary feel.'],
 ['blueprint','Clear Systems','Structured layouts that make complex ideas easy to understand.'],
 ['notebook','Service Notebook','Approachable notes and practical, human storytelling.'],
 ['playful','Playful Club','Expressive shapes and a light, playful personality.'],
 ['type','Type Takes Over','Confident typography with short, readable headlines.'],
 ['ritual','Quiet Ritual','Calm compositions, gentle light and everyday rituals.'],
 ['field','Field Journal','Outdoor textures and a sense of exploration.'],
 ['colourblock','Colour Block Shop','Strong blocks of colour and simple product compositions.'],
 ['heritage','Modern Heritage','Traditional character with a contemporary finish.'],
 ['magazine','Independent Magazine','Editorial storytelling with distinctive art direction.'],
 ['ink','Ink & Paper','Tactile paper textures and an illustrated feel.'],
 ['clarity','Clear Thinking','Simple visual hierarchy with focused, uncluttered layouts.'],
 ['sport','In Motion','Dynamic movement and energetic compositions.'],
];
const directionText=(row:string[])=>`${row[1]}. ${row[2]}`;
export function CreativeBrief({value={},onChange,disabled=false}:{value?:CreativeBriefValue;onChange:(value:CreativeBriefValue)=>void;disabled?:boolean}){
 const chosen=directions.find(row=>directionText(row)===value.direction);
 const change=(key:keyof CreativeBriefValue,next:string)=>onChange({...value,[key]:next});
 return <details className="creative-brief" open={undefined}>
  <summary>Your creative brief <span>Optional</span></summary>
  <p className="hint">A little context helps us create more relevant content. Skip anything you are unsure of. You can change these answers in Content Preferences.</p>
  <fieldset disabled={disabled}><legend className="sr-only">Creative brief</legend>
   <div className="creative-brief-fields">
    <Field label="Which markets do you want to reach?">{id=><input id={id} maxLength={600} value={value.markets??''} onChange={e=>change('markets',e.target.value)} placeholder="For example: Mumbai and Thane, young families"/>}</Field>
    <Field label="Which languages should your content use?">{id=><input id={id} maxLength={600} value={value.languages??''} onChange={e=>change('languages',e.target.value)} placeholder="For example: English, with occasional Hindi"/>}</Field>
   </div>
   <Field label="Any launch dates or timing to keep in mind?" hint="Planning context only. This does not schedule or publish posts.">{(id,hint)=><textarea id={id} aria-describedby={hint} rows={2} maxLength={600} value={value.timing??''} onChange={e=>change('timing',e.target.value)} placeholder="Upcoming launches, seasonal moments or deadlines"/>}</Field>
   <Field label="Explore a creative direction" hint="Style inspiration from the Desvio website. Your approved brand guidelines still apply.">{(id,hint)=><DesvioSelect id={id} aria-describedby={hint} disabled={disabled} value={chosen?.[0]??''} onChange={e=>{const row=directions.find(r=>r[0]===e.target.value);change('direction',row?directionText(row):'');}}><option value="">{value.direction?'Custom direction':'No preference yet'}</option>{directions.map(row=><option key={row[0]} value={row[0]}>{row[1]}</option>)}</DesvioSelect>}</Field>
   {chosen&&<figure className="creative-direction-preview"><img src={`/onboarding/styles/${chosen[0]}.webp`} width={480} height={320} alt={`${chosen[1]} style inspiration`} loading="lazy"/><figcaption><strong>{chosen[1]}</strong><p>{chosen[2]}</p><small>Inspiration only, not a generated creative for your business.</small></figcaption></figure>}
   <Field label="Describe or refine your visual direction">{id=><textarea id={id} rows={3} maxLength={600} value={value.direction??''} onChange={e=>change('direction',e.target.value)} placeholder="Choose a direction above, or describe the look you have in mind."/>}</Field>
  </fieldset>
 </details>;
}
