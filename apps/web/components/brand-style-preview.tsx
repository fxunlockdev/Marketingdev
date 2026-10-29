"use client";
import {useId} from 'react';
import {BRAND_FONT_PAIRINGS as pairings,BRAND_FONTS,parseBrandTypography,serializeBrandTypography,type BrandTypography} from '../../api/src/brand-typography';
import './brand-typography.css';
const weightNames:Record<number,string>={100:'Thin',200:'Extra light',300:'Light',400:'Regular',500:'Medium',600:'Semibold',700:'Bold',800:'Extra bold',900:'Black'};
export function BrandFontChoices({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
 const id=useId(), selected=parseBrandTypography(value), typography=selected??{headline:{family:'DM Sans',weight:600},body:{family:'DM Sans',weight:400}} as BrandTypography;
 const update=(role:'headline'|'body',change:Partial<BrandTypography['headline']>)=>{const next={...typography[role],...change};const family=BRAND_FONTS.find(f=>f.family===next.family)!;if(!family.weights.some(w=>w===next.weight))next.weight=400;onChange(serializeBrandTypography({...typography,[role]:next}));};
 return <fieldset className="brand-type-controls" disabled={disabled}><legend>Fonts</legend><p className="hint">Choose your title and body fonts. Preview the pairing before you save.</p>
 {!selected&&<p className="hint">Choose a pairing below to replace the current font description with supported fonts.</p>}
 <div className="brand-type-fields">{(['headline','body'] as const).map(role=><div className="brand-type-role" key={role}><label htmlFor={`${id}-${role}`}>{role==='headline'?'Title font':'Body font'}</label><select id={`${id}-${role}`} value={typography[role].family} onChange={e=>update(role,{family:e.target.value as BrandTypography['headline']['family']})}>{BRAND_FONTS.map(font=><option key={font.family} value={font.family}>{font.family}</option>)}</select><label htmlFor={`${id}-${role}-weight`}>{role==='headline'?'Title weight':'Body weight'}</label><select id={`${id}-${role}-weight`} value={typography[role].weight} onChange={e=>update(role,{weight:Number(e.target.value) as BrandTypography['headline']['weight']})}>{BRAND_FONTS.find(font=>font.family===typography[role].family)!.weights.map(weight=><option key={weight} value={weight}>{weightNames[weight]??weight}</option>)}</select></div>)}</div>
 <div className="brand-type-live" aria-label="Font pairing preview"><span className="brand-type-kicker">YOUR BRAND, YOUR WAY</span><strong style={{fontFamily:typography.headline.family,fontWeight:typography.headline.weight}}>Make a lasting impression.</strong><p style={{fontFamily:typography.body.family,fontWeight:typography.body.weight}}>Your story deserves to stand out. Bring every idea to life with a voice and style that feels unmistakably yours.</p><small>{typography.headline.family} / {typography.body.family}</small></div>
 <div className="brand-type-presets" role="group" aria-label="Font pairing presets">{pairings.map(pair=>{const fonts=parseBrandTypography(pair.value)!;return <button type="button" key={pair.id} aria-pressed={value===pair.value} onClick={()=>onChange(pair.value)}><span>{pair.name}</span><strong style={{fontFamily:fonts.headline.family,fontWeight:fonts.headline.weight}}>Aa</strong><small>{fonts.headline.family}</small></button>;})}</div>
 </fieldset>;
}
export function BrandStylePreview({field,value}:{field:string;value:string}){
 if(field==='colors'){
  const colors=[...new Set(value.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)??[])].slice(0,12);
  return colors.length?<ul className="brand-color-swatches" aria-label="Brand colors">{colors.map(color=><li key={color}><span style={{backgroundColor:color}} aria-hidden="true"/><code>{color.toUpperCase()}</code></li>)}</ul>:null;
 }
 if(field!=='fonts')return null;
 const typography=parseBrandTypography(value);
 return typography?<div className="brand-type-live" aria-label="Typography preview"><strong style={{fontFamily:typography.headline.family,fontWeight:typography.headline.weight}}>Make it yours.</strong><p style={{fontFamily:typography.body.family,fontWeight:typography.body.weight}}>A little detail. A lasting impression.</p><small>{typography.headline.family} / {typography.body.family}</small></div>:null;
}
