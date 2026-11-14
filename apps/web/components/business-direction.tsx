import type {ReactNode} from 'react';
import styles from './business-direction.module.css';
import './brand-typography.css';

export type ProposedDirection={
 summary:string;rationale?:string;palette:{role:string;hex:string}[];heading_font?:string;body_font?:string;
 voice?:string;imagery?:string;pillars:string[];essential_questions:string[];
};

const sentence=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
/** Research text often opens with "Proposed:" or "Proposed direction:"; the sheet already says it is a proposal. */
const plain=(text?:string)=>sentence((text??'').replace(/^\s*proposed(?: direction)?:\s*/i,'').trim());

/** "Project discovery: introduce one property…" → title and description. */
export function splitPillar(pillar:string):[string,string]{
 const at=pillar.indexOf(':');
 return at>0&&at<60?[pillar.slice(0,at).trim(),sentence(pillar.slice(at+1).trim())]:[pillar.trim(),''];
}

/** Light or dark swatch, so the role and code printed on it stay readable. */
export function swatchTone(hex:string):'light'|'dark'{
 const m=/^#?([0-9a-f]{6})$/i.exec(hex.trim());if(!m)return 'light';
 const [r,g,b]=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);
 return 0.2126*r+0.7152*g+0.0722*b>0.4?'light':'dark';
}

const WEIGHT:Record<string,number>={primary:5,secondary:3,accent:2};
const fontStack=(name:string|undefined,fallback:string)=>name?`"${name.replace(/"/g,'')}", ${fallback}`:fallback;

/** The researched brand direction as a one-page sheet: colour, type, voice, imagery and pillars. */
export function BusinessDirection({direction,note,children}:{direction:ProposedDirection;note?:ReactNode;children?:ReactNode}){
 const colour=(role:string)=>direction.palette.find(c=>c.role===role)?.hex;
 const [sampleTitle,sampleBody]=direction.pillars[0]?splitPillar(direction.pillars[0]):['Your next post',''];
 const voice=plain(direction.voice),imagery=plain(direction.imagery);
 return <article className={styles.sheet} aria-labelledby="direction-title">
  <header className={styles.intro}>
   <p className="eyebrow">Proposed direction</p>
   <h2 id="direction-title" className={styles.title}>What we learned</h2>
   {note}
   <p className={styles.lead}>{plain(direction.summary)}</p>
   {direction.rationale&&<p className={styles.why}>{plain(direction.rationale)}</p>}
  </header>

  {direction.essential_questions.length>0&&<aside className={styles.ask} aria-labelledby="direction-questions">
   <p id="direction-questions" className={styles.askLabel}>Needs your answer</p>
   <ul>{direction.essential_questions.map(q=><li key={q}>{q}</li>)}</ul>
  </aside>}

  <div className={styles.board}>
   {direction.palette.length>0&&<section aria-labelledby="direction-colour" className={styles.panel}>
    <h3 id="direction-colour" className={styles.kicker}>Colour</h3>
    <ul className={styles.strip}>
     {direction.palette.map(c=><li key={c.role} data-tone={swatchTone(c.hex)} style={{background:c.hex,flexGrow:WEIGHT[c.role]??2}}>
      <strong>{c.role}</strong><code>{c.hex.toUpperCase()}</code>
     </li>)}
    </ul>
   </section>}
   {(direction.heading_font||direction.body_font)&&<section aria-labelledby="direction-type" className={styles.panel}>
    <h3 id="direction-type" className={styles.kicker}>Type</h3>
    <figure className={styles.specimen} style={{background:colour('secondary'),color:colour('primary')}}>
     <span className={styles.rule} style={{background:colour('accent')}} aria-hidden="true"/>
     <p className={styles.display} style={{fontFamily:fontStack(direction.heading_font,'var(--font-family-heading)')}}>{sampleTitle}</p>
     {sampleBody&&<p className={styles.body} style={{fontFamily:fontStack(direction.body_font,'var(--font-family-body)')}}>{sampleBody}</p>}
     <figcaption className={styles.fonts}>
      {direction.heading_font&&<span><small>Headings</small>{direction.heading_font}</span>}
      {direction.body_font&&<span><small>Body</small>{direction.body_font}</span>}
     </figcaption>
    </figure>
   </section>}
  </div>

  {(voice||imagery)&&<div className={styles.notes}>
   {voice&&<section aria-labelledby="direction-voice"><h3 id="direction-voice" className={styles.kicker}>Voice</h3><p>{voice}</p></section>}
   {imagery&&<section aria-labelledby="direction-imagery"><h3 id="direction-imagery" className={styles.kicker}>Imagery</h3><p>{imagery}</p></section>}
  </div>}

  {direction.pillars.length>0&&<section aria-labelledby="direction-pillars">
   <h3 id="direction-pillars" className={styles.kicker}>Content pillars</h3>
   <ol className={styles.pillars}>
    {direction.pillars.map((p,i)=>{const [title,body]=splitPillar(p);return <li key={p}>
     <span className={styles.num} aria-hidden="true">{String(i+1).padStart(2,'0')}</span>
     <strong>{title}</strong>{body&&<p>{body}</p>}
    </li>;})}
   </ol>
  </section>}

  <footer className={styles.foot}>
   <p>These are suggestions, not approved brand rules or generated previews.</p>
   {children}
  </footer>
 </article>;
}
