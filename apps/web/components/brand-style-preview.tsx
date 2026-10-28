"use client";
import {BRAND_FONT_PAIRINGS as pairings} from '../../api/src/brand-typography';
export function BrandFontChoices({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}){
 return <fieldset className="brand-font-picker" disabled={disabled}><legend>Choose a font pairing</legend><div>{pairings.map(pair=><button type="button" key={pair.id} aria-pressed={value===pair.value} onClick={()=>onChange(pair.value)} className={`brand-font-choice font-${pair.id}`}><span>{pair.name}</span><strong style={{fontFamily:pair.family}}>Make it yours.</strong><span className="brand-font-body">A little detail. A lasting impression.</span><small>{pair.family} · DM Sans</small></button>)}</div></fieldset>;
}
export function BrandStylePreview({field,value}:{field:string;value:string}){
 if(field==='colors'){
  const colors=[...new Set(value.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)??[])].slice(0,12);
  return colors.length?<ul className="brand-color-swatches" aria-label="Brand colors">{colors.map(color=><li key={color}><span style={{backgroundColor:color}} aria-hidden="true"/><code>{color.toUpperCase()}</code></li>)}</ul>:null;
 }
 if(field!=='fonts')return null;
 const pair=pairings.find(p=>p.value===value);
 const family=/DM Serif Display/i.test(value)?'DM Serif Display':/DM Sans/i.test(value)?'DM Sans':undefined;
 return family?<div className={`brand-font-sample font-${pair?.id??'modern'}`} aria-label="Typography preview"><strong style={{fontFamily:family}}>Make it yours.</strong><span>A little detail. A lasting impression.</span></div>:null;
}
