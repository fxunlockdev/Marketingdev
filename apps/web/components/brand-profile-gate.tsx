"use client";
import {useEffect,useState} from 'react';
import {api} from './api';
import {AppLink} from './app-link';
import {Notice} from './primitives';
import {factLabel} from './fact-labels';
import styles from './brand-profile-gate.module.css';

/** Where an owner reviews the brand profile in full. */
export const brandProfilePath=(businessId:string):string=>`/b/${businessId}/brand-kit#profile`;

/** True for the API's "approve your brand profile first" refusals, not for integrity or size errors. */
export function isBrandProfileError(error:unknown):boolean{
 if(!(error instanceof Error))return false;
 const m=error.message;
 return /brand (profile|knowledge)/i.test(m)&&/\b(approve|confirm)\b/i.test(m)&&!/integrity|exceeds|dimensions/i.test(m);
}

type Finding={id:string;field:string;value:string;status:'unreviewed'|'correct'|'edited'|'wrong';revision:number};
type Brain={revision:number;findings:Finding[]};
type FactGroup={field:string;options:Finding[]};
export type GateBusiness={id:string;organization_id?:string;role:string};

const REQUIRED=['brand_name','offering','audience'];
const ORDER=['brand_name','offering','audience','positioning','voice','cta','colors','fonts','products','prohibited_claims'];

/** One group per field, required fields first; only options not already marked wrong. */
export function factGroups(findings:Finding[]):FactGroup[]{
 const live=findings.filter(f=>f.status!=='wrong'&&f.value?.trim());
 const fields=[...new Set(live.map(f=>f.field))].sort((a,b)=>(ORDER.indexOf(a)+1||99)-(ORDER.indexOf(b)+1||99));
 return fields.map(field=>({field,options:live.filter(f=>f.field===field)}));
}

/** The reviewed value per field: an existing confirmation wins, otherwise the first suggestion. */
export function defaultChoices(groups:FactGroup[]):Record<string,string>{
 return Object.fromEntries(groups.map(g=>[g.field,(g.options.find(o=>o.status==='correct'||o.status==='edited')??g.options[0]).id]));
}

/**
 * Explains why creating is blocked and lets an owner approve the brand profile right here:
 * the researched facts are listed, duplicates become a choice, and one button confirms and approves.
 */
export function BrandProfileGate({business,compact=false,onApproved}:{business:GateBusiness;compact?:boolean;onApproved?:()=>void}){
 const canApprove=['owner','admin'].includes(business.role)&&!!business.organization_id;
 const path=`/api/v1/workspaces/${business.organization_id}/brands/${business.id}/brain`;
 const [brain,setBrain]=useState<Brain>(),[choices,setChoices]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[done,setDone]=useState(false);
 useEffect(()=>{
  if(!canApprove)return;let live=true;
  api<Brain>(path).then(b=>{if(!live)return;setBrain(b);setChoices(defaultChoices(factGroups(b.findings)));}).catch(e=>{if(live)setError(e);});
  return ()=>{live=false;};
 },[path,canApprove]);
 const groups=brain?factGroups(brain.findings):[];
 const missing=brain?REQUIRED.filter(f=>!groups.some(g=>g.field===f)):[];

 async function approve(){
  if(!brain||busy)return;setBusy(true);setError(undefined);
  try{
   for(const group of groups){
    const chosen=group.options.find(o=>o.id===choices[group.field])??group.options[0],others=group.options.filter(o=>o.id!==chosen.id);
    if(chosen.status==='unreviewed')await api(`${path}/findings/${chosen.id}`,{revision:chosen.revision,decision:'correct',...(others.length?{alternatives:others.map(o=>({id:o.id,revision:o.revision}))}:{})},'PATCH');
    else for(const other of others)await api(`${path}/findings/${other.id}`,{revision:other.revision,decision:'wrong'},'PATCH');
   }
   const current=await api<Brain>(path);
   await api(`${path}/approve`,{revision:current.revision});
   setDone(true);window.dispatchEvent(new Event('desvio-workspace-changed'));onApproved?.();
  }catch(e){
   setError(e);
   try{const fresh=await api<Brain>(path);setBrain(fresh);setChoices(defaultChoices(factGroups(fresh.findings)));}catch{/* The first error is already shown. */}
  }finally{setBusy(false);}
 }

 const title=done?'Brand profile approved':'Approve your brand profile to start creating';
 return <aside className={styles.gate} data-compact={compact||undefined} aria-labelledby={`profile-gate-${business.id}`}>
  <p id={`profile-gate-${business.id}`} className={styles.title}>{title}</p>
  {done?<p className={styles.body} role="status">You can create posts now.</p>:!canApprove?
   <p className={styles.body}>Desvio writes every post from the confirmed business name, offer and audience. Ask an owner or admin of this business to approve it.</p>:<>
   <p className={styles.body}>Desvio writes every post from these details. Check them and approve once.</p>
   {!brain&&!error&&<p className={styles.body} role="status">Loading your details…</p>}
   {groups.length>0&&<ul className={styles.facts}>
    {groups.map(g=><li key={g.field}>
     <span className={styles.field}>{factLabel(g.field)}</span>
     {g.options.length===1?<span className={styles.value}>{g.options[0].value}</span>:
      <fieldset className={styles.choice}><legend>Choose one {factLabel(g.field).toLowerCase()}</legend>
       {g.options.map(o=><label key={o.id}><input type="radio" name={`${business.id}-${g.field}`} checked={choices[g.field]===o.id} disabled={busy} onChange={()=>setChoices(c=>({...c,[g.field]:o.id}))}/>{o.value}</label>)}
      </fieldset>}
    </li>)}
   </ul>}
   {missing.length>0&&<p className={styles.body}>Add {missing.map(f=>factLabel(f).toLowerCase()).join(', ')} in Brand Kit before approving.</p>}
   <Notice error={error}/>
   <div className={styles.actions}>
    {brain&&!missing.length&&<button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={()=>void approve()}>{busy?'Approving…':'Approve and start creating'}</button>}
    <AppLink className="button" href={brandProfilePath(business.id)}>{missing.length?'Open Brand Kit →':'Edit details in Brand Kit'}</AppLink>
   </div>
  </>}
 </aside>;
}
