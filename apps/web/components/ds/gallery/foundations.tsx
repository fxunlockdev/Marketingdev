"use client";
import {useState, type CSSProperties, type ReactNode} from 'react';
import styles from './gallery.module.css';
import {Button} from '../button';
import {Card} from '../card';
import {glass} from '../materials';
import {Eyebrow, Heading, Text} from '../text';
import {cx} from '../cx';

/** One titled block of the gallery. */
export function Section({id, title, description, children}: {id: string; title: string; description: string; children: ReactNode}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.sectionHead}>
        <Heading id={`${id}-title`}>{title}</Heading>
        <Text tone="muted" size="callout">{description}</Text>
      </div>
      {children}
    </section>
  );
}

const PALETTE: Array<[string, string]> = [
  ['Paper', '--brand-paper'], ['Field', '--brand-field'], ['Surface', '--brand-surface'], ['Ink', '--brand-ink'],
  ['Lime accent', '--brand-accent'], ['Pale green', '--brand-wash'], ['Olive link', '--brand-link'], ['Muted text', '--brand-muted'],
  ['Sand', '--brand-sand'], ['Border', '--brand-border'],
];
const RAMP: Array<[string, string, string, string]> = [
  ['Display', '--text-display', '--tracking-display', 'Good morning, Maya'],
  ['Title', '--text-title', '--tracking-title', 'What Desvio knows'],
  ['Heading', '--text-heading', '--tracking-heading', 'Upcoming posts'],
  ['Subheading', '--text-subheading', '--tracking-body', 'Residential projects'],
  ['Body', '--text-body', '--tracking-body', 'Approved items shape every plan and post.'],
  ['Callout', '--text-callout', '--tracking-body', 'Approve and start creating'],
  ['Caption', '--text-caption', '--tracking-body', 'From your research · 2 sources'],
];
const RADII = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
const SPRINGS: Array<[string, string]> = [['Gentle', '--spring-gentle'], ['Snappy', '--spring-snappy'], ['Bouncy', '--spring-bouncy'], ['Ease out', '--ease-out']];
const GLASS: Array<['thin' | 'regular' | 'thick' | 'dark', string, string]> = [
  ['thin', 'Thin', 'Top bar, sticky headers'], ['regular', 'Regular', 'Sidebar, popovers, toasts'],
  ['thick', 'Thick', 'Modals, menus'], ['dark', 'Dark', 'The emphasis card, tooltips'],
];

/** Tokens made visible: palette, type, radius, elevation, glass and motion. */
export function Foundations() {
  const [moved, setMoved] = useState(false);
  return (
    <>
      <Section id="colour" title="Colour" description="The existing palette, unchanged. Tints and glass are derived from these values; no new hue is added.">
        <ul className={styles.swatches}>
          {PALETTE.map(([name, token]) => (
            <li key={token} className={styles.swatch}><i style={{'--swatch': `var(${token})`} as CSSProperties} /><strong>{name}</strong>{token}</li>
          ))}
        </ul>
      </Section>

      <Section id="type" title="Type" description="One ramp for every page: a single page title, then section, card, body and caption.">
        <Card>
          <div className={styles.ramp}>
            {RAMP.map(([name, font, tracking, sample]) => (
              <div key={name}><Eyebrow as="span">{name}</Eyebrow><p style={{font: `var(${font})`, letterSpacing: `var(${tracking})`}}>{sample}</p></div>
            ))}
          </div>
        </Card>
      </Section>

      <Section id="shape" title="Radius and elevation" description="Six corner sizes and four shadows. Nested corners step down one size.">
        <div className={styles.gridWide}>
          <div className={styles.spec}>
            <p className={styles.label}>Radius</p>
            <div className={styles.radii}>{RADII.map(r => <div key={r} style={{borderRadius: `var(--radius-${r})`}}>{r}</div>)}</div>
          </div>
          <div className={styles.spec}>
            <p className={styles.label}>Elevation</p>
            <div className={styles.shadows}>{[1, 2, 3, 4].map(n => <div key={n} style={{boxShadow: `var(--elevation-${n})`}}>{n}</div>)}</div>
          </div>
        </div>
      </Section>

      <Section id="glass" title="Glass" description="Four materials for layers that float. Content cards stay solid so text is easy to read.">
        <div className={styles.glassStage}>
          {GLASS.map(([tier, name, use]) => (
            <div key={tier} className={cx(styles.glassTile, glass(tier))}><strong>{name}</strong>{use}</div>
          ))}
        </div>
      </Section>

      <Section id="motion" title="Motion" description="Springs for what you touch, a short ease for everything else. Only position and opacity move.">
        <Card>
          <div className={styles.stack}>
            <div className={styles.springs} data-on={moved || undefined}>
              {SPRINGS.map(([name, token]) => (
                <div key={token} className={styles.track}><span className={styles.dot} style={{'--curve': `var(${token})`} as CSSProperties}>{name}</span></div>
              ))}
            </div>
            <div className={styles.row}><Button variant="secondary" onClick={() => setMoved(v => !v)}>Play the curves</Button></div>
          </div>
        </Card>
      </Section>
    </>
  );
}
