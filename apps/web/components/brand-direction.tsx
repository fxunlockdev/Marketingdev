"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {api} from './api';
import {Field,Loading,Notice} from './primitives';
import {DesvioSelect} from './desvio-select';
import {ActionButton} from './design-system';
import {AppLink} from './app-link';
import {ONBOARDING_REFERENCES} from '../../api/src/onboarding-references';
import {lookStyle,type LookPalette} from '../../api/src/look-styles';
import {BRAND_FONTS} from '../../api/src/brand-typography';
import {MAX_LOOKS,PALETTE_ROLES,type BrandDirection} from '../../api/src/brand-direction';
import './brand-typography.css';
import styles from './brand-direction.module.css';

export type StoredDirection={id:string;version:number;source:'onboarding'|'brand_kit';direction:BrandDirection;created_at:string};
export type DirectionState={current:StoredDirection|null;versions:{id:string;version:number;source:string;created_at:string}[];legacy_moodboard:BrandDirection|null;can_edit:boolean};
type Business={id:string;organization_id:string;name:string;role?:string};
type Draft={looks:string[];palette:LookPalette;heading_font:string;heading_weight:number;body_font:string;body_weight:number};

const ROLE_LABELS:Record<keyof LookPalette,string>={dominant:'Main colour',headline:'Headline colour',accent:'Accent colour',background:'Background colour'};
const INDUSTRIES:Record<string,string>={food:'Food & drink',retail:'Retail & lifestyle',sport:'Fitness',property:'Home & property',local:'Local services',professional:'Professional services',general:'General styles'};
const WEIGHT_NAMES:Record<number,string>={100:'Thin',200:'Extra light',300:'Light',400:'Regular',500:'Medium',600:'Semibold',700:'Bold',800:'Extra bold',900:'Black'};
const lookName=(id:string)=>ONBOARDING_REFERENCES.find(r=>r.id===id)?.name??'Look';
const draftOf=(d:BrandDirection):Draft=>({looks:d.looks.map(l=>l.id),palette:{...d.palette},heading_font:d.heading_font,heading_weight:d.heading_weight,body_font:d.body_font,body_weight:d.body_weight});

/** A post-shaped sample of the direction: panel, headline type, brand line and accent. Colours are data. */
export function DirectionPreview({direction,businessName,headline='A little of what makes you, you.'}:{direction:Pick<BrandDirection,'palette'|'heading_font'|'heading_weight'|'body_font'|'body_weight'>;businessName:string;headline?:string}){
 const p=direction.palette;
 const frame:CSSProperties={background:p.dominant},panel:CSSProperties={background:p.background,color:p.headline};
 return <figure className={styles.preview} style={frame} aria-label="Sample post in your creative direction">
  <div className={styles.previewPanel} style={panel}>
   <span className={styles.previewBrand} style={{fontFamily:direction.body_font,fontWeight:direction.body_weight}}>{businessName}</span>
   <strong style={{fontFamily:direction.heading_font,fontWeight:direction.heading_weight}}>{headline}</strong>
   <span className={styles.previewAccent} style={{background:p.accent}} aria-hidden="true"/>
  </div>
  <figcaption className="sr-only">Sample only; your posts are designed for each topic.</figcaption>
 </figure>;
}

function Swatches({palette}:{palette:LookPalette}){
 return <ul className={styles.swatches} aria-label="Palette">{PALETTE_ROLES.map(role=><li key={role}><span style={{background:palette[role]}} aria-hidden="true"/><strong>{ROLE_LABELS[role]}</strong><small>{palette[role]}</small></li>)}</ul>;
}

function DirectionFacts({direction}:{direction:BrandDirection}){
 return <div className={styles.facts}>
  {direction.looks.length>0&&<ul className={styles.looks} aria-label="Your looks">{direction.looks.map((l,i)=><li key={l.id}><img src={l.src} alt="" width="120" height="150" loading="lazy"/><span>{i===0?'Main look · ':''}{l.name}</span></li>)}</ul>}
  <section className={styles.type} aria-label="Fonts"><p className="eyebrow">Fonts</p><p style={{fontFamily:direction.heading_font,fontWeight:direction.heading_weight}} className={styles.typeSample}>{direction.heading_font}</p><p style={{fontFamily:direction.body_font,fontWeight:direction.body_weight}}>{direction.body_font} for supporting text</p></section>
  <Swatches palette={direction.palette}/>
  {(direction.voice||direction.tone)&&<p><strong>Voice:</strong> {direction.voice||direction.tone}</p>}
 </div>;
}

/** Onboarding: the compact "Your brand direction" summary shown before planning. */
export function BrandDirectionSummary({business,direction}:{business:Business;direction:StoredDirection}){
 const d=direction.direction;
 return <section className={styles.summary} aria-labelledby="brand-direction-heading">
  <p className="eyebrow">Saved as your brand guide</p><h2 id="brand-direction-heading">Your brand direction</h2>
  <p>{d.looks.length?'Your social posts will use the looks you picked: these colours, fonts and layouts, with the voice from our research.':'We used your researched colours, fonts and voice. Pick looks in Brand Kit at any time.'}</p>
  <div className={styles.summaryGrid}><DirectionFacts direction={d}/><DirectionPreview direction={d} businessName={business.name}/></div>
  <AppLink className="button" href={`/b/${business.id}/brand-kit#direction`}>Edit in Brand Kit</AppLink>
 </section>;
}

function LookGallery({picked,onChange,disabled}:{picked:string[];onChange:(looks:string[])=>void;disabled:boolean}){
 const first=ONBOARDING_REFERENCES.find(r=>r.id===picked[0])?.industry??'general';
 const [group,setGroup]=useState<string>(first);
 const toggle=(id:string)=>onChange(picked.includes(id)?picked.filter(x=>x!==id):[...picked,id].slice(0,MAX_LOOKS));
 return <fieldset className={styles.gallery} disabled={disabled}><legend>Looks</legend>
  <p className="hint">Pick up to three, in order. The first sets your colours, fonts and main layout; the others add variety.</p>
  <div className={styles.picked} aria-live="polite">{picked.length?picked.map((id,i)=><button type="button" key={id} aria-label={`Remove ${lookName(id)}`} onClick={()=>toggle(id)}>{i+1}. {lookName(id)} ×</button>):<p>No looks picked.</p>}</div>
  <Field label="Explore looks">{id=><DesvioSelect id={id} value={group} onChange={e=>setGroup(e.target.value)}>{Object.entries(INDUSTRIES).map(([value,label])=><option key={value} value={value}>{label}</option>)}</DesvioSelect>}</Field>
  <div className={styles.grid}>{ONBOARDING_REFERENCES.filter(r=>r.industry===group).map(r=><article key={r.id}><img src={r.src} alt={r.name} width="240" height="300" loading="lazy"/><button type="button" aria-pressed={picked.includes(r.id)} disabled={!picked.includes(r.id)&&picked.length>=MAX_LOOKS} onClick={()=>toggle(r.id)}>{picked.includes(r.id)?`${picked.indexOf(r.id)+1}. `:''}{r.name}</button></article>)}</div>
 </fieldset>;
}

function TypeControls({draft,set}:{draft:Draft;set:(next:Draft)=>void}){
 return <div className={styles.fields}>{([['heading_font','heading_weight','Heading font','Heading weight'],['body_font','body_weight','Body font','Body weight']] as const).map(([font,weight,label,weightLabel])=>{
  const weights=BRAND_FONTS.find(f=>f.family===draft[font])?.weights??[400];
  return <div key={font} className={styles.fontRole}>
   <Field label={label}>{id=><DesvioSelect id={id} value={draft[font]} onChange={e=>{const next=BRAND_FONTS.find(f=>f.family===e.target.value);const w=next&&!(next.weights as readonly number[]).includes(draft[weight])?400:draft[weight];set({...draft,[font]:e.target.value,[weight]:next&&(next.weights as readonly number[]).includes(w)?w:next?.weights[0]??400});}}>{BRAND_FONTS.map(f=><option key={f.family} value={f.family}>{f.family}</option>)}</DesvioSelect>}</Field>
   <Field label={weightLabel}>{id=><DesvioSelect id={id} value={String(draft[weight])} onChange={e=>set({...draft,[weight]:Number(e.target.value)})}>{weights.map(w=><option key={w} value={w}>{WEIGHT_NAMES[w]??w}</option>)}</DesvioSelect>}</Field>
  </div>;})}</div>;
}

/** Brand Kit: owners and admins change looks and fine-tune colours and fonts; everyone else reads. */
export function BrandDirectionSettings({business}:{business:Business}){
 const root=`/api/v1/businesses/${business.id}/creative-direction`;
 const [state,setState]=useState<DirectionState>(),[draft,setDraft]=useState<Draft>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false),[saved,setSaved]=useState<number>(),[reset,setReset]=useState(false);
 const status=useRef<HTMLParagraphElement>(null);
 async function load(){const value=await api<DirectionState>(root);setState(value);const base=value.current?.direction??value.legacy_moodboard;setDraft(base?draftOf(base):undefined);}
 useEffect(()=>{let live=true;api<DirectionState>(root).then(value=>{if(!live)return;setState(value);const base=value.current?.direction??value.legacy_moodboard;setDraft(base?draftOf(base):undefined);}).catch(e=>{if(live)setError(e);});return()=>{live=false;};},[root]);
 if(!state)return <><Notice error={error}/>{!error&&<Loading/>}</>;
 const shown=state.current?.direction??state.legacy_moodboard;
 if(!state.can_edit)return <section className={styles.settings}>
  {shown?<DirectionFacts direction={shown}/>:<p>No creative direction has been saved yet.</p>}
  {shown&&<DirectionPreview direction={shown} businessName={business.name}/>}
  <p className="hint">Only a business owner or admin can change the creative direction.</p>
 </section>;
 const current=draft??{looks:[],palette:{dominant:'',headline:'',accent:'',background:''},heading_font:'DM Sans',heading_weight:600,body_font:'DM Sans',body_weight:400};
 const changeLooks=(looks:string[])=>{
  const primary=looks[0]&&lookStyle(looks[0]);
  // A new main look brings its own colours and fonts; fine-tune them afterwards.
  if(primary&&looks[0]!==current.looks[0]){setDraft({looks,palette:{...primary.palette},heading_font:primary.heading_font,heading_weight:primary.heading_weight,body_font:primary.body_font,body_weight:primary.body_weight});setReset(true);}
  else setDraft({...current,looks});
 };
 const complete=PALETTE_ROLES.every(role=>/^#[0-9a-f]{6}$/i.test(current.palette[role]))&&(current.looks.length>0||!!shown);
 const unchanged=!!shown&&JSON.stringify(draftOf(shown))===JSON.stringify(current);
 async function save(){setBusy(true);setError(undefined);try{const next=await api<StoredDirection>(root,{base_version:state?.current?.version??0,...current});setSaved(next.version);setReset(false);await load();status.current?.focus();}catch(e){setError(e);}finally{setBusy(false);}}
 return <section className={styles.settings}>
  <p>{state.current?`Version ${state.current.version}, saved ${new Date(state.current.created_at).toLocaleDateString()}.`:state.legacy_moodboard?'Your approved mood board is your direction today. Saving here replaces it for new posts.':'Pick at least one look to set your direction.'}</p>
  <LookGallery picked={current.looks} onChange={changeLooks} disabled={busy}/>
  {reset&&<p className="hint" role="status">Colours and fonts now match your new main look. Fine-tune them below.</p>}
  <fieldset className={styles.tune} disabled={busy||!complete}><legend>Fine-tune colours and fonts</legend>
   <div className={styles.fields}>{PALETTE_ROLES.map(role=><Field key={role} label={ROLE_LABELS[role]}>{id=><input id={id} type="color" value={current.palette[role]} onChange={e=>setDraft({...current,palette:{...current.palette,[role]:e.target.value}})}/>}</Field>)}</div>
   <TypeControls draft={current} set={setDraft}/>
  </fieldset>
  {complete&&<><h3>Preview</h3><DirectionPreview direction={{...current,heading_font:current.heading_font as BrandDirection['heading_font'],body_font:current.body_font as BrandDirection['body_font'],heading_weight:current.heading_weight as BrandDirection['heading_weight'],body_weight:current.body_weight as BrandDirection['body_weight']}} businessName={business.name}/></>}
  <Notice error={error}/>
  <p className="hint">Saving creates a new version. It applies to posts generated after you save; posts already made or being made keep their current look.</p>
  <ActionButton type="button" className="primary" disabled={busy||!complete||unchanged} onClick={()=>void save()} label={busy?'Saving…':'Save as new version'}/>
  <p ref={status} tabIndex={-1} role="status">{saved?`Version ${saved} saved. New posts will use it.`:''}</p>
  {state.versions.length>1&&<details><summary>Version history</summary><ol reversed>{state.versions.map(v=><li key={v.id}>Version {v.version} · {v.source==='brand_kit'?'Brand Kit':'Onboarding'} · {new Date(v.created_at).toLocaleDateString()}</li>)}</ol></details>}
 </section>;
}
