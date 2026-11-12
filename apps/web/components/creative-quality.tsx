"use client";
import {useState, type FormEvent} from 'react';
import {StatusBadge, type Status} from './ui/status-badge';
import {Button} from './ui/button';
import {Field} from './primitives';
import styles from './creative-quality.module.css';

/** Bounded review fields from the API's quality summary (never the raw checker output). */
export type QaSummary = {
  verdict: 'pass' | 'flag' | 'unavailable';
  text_mode: 'in_image' | 'overlay' | 'none' | null;
  expected_text: string[];
  text_matches: boolean | null;
  found_text: string[];
  notes: string[];
  retried: boolean;
  message: string;
};

const badges: Record<QaSummary['verdict'], {status: Status; label: string}> = {
  pass: {status: 'approved', label: 'Quality checked'},
  flag: {status: 'needs_attention', label: 'Needs a look'},
  unavailable: {status: 'not_started', label: 'Not checked'},
};

/** The automatic quality check of a creative, as a badge and one plain sentence. */
export function CreativeQuality({qa}: {qa: QaSummary | null | undefined}) {
  if (!qa) return null;
  const badge = badges[qa.verdict];
  const extra = qa.verdict === 'flag' ? qa.notes.filter(note => !qa.message.endsWith(note)) : [];
  return (
    <section className={styles.quality} data-verdict={qa.verdict} aria-label="Automatic quality check">
      <StatusBadge status={badge.status} label={badge.label} />
      <p className={styles.message}>{qa.message}</p>
      {extra.length > 0 && <ul className={styles.notes}>{extra.map(note => <li key={note}>{note}</li>)}</ul>}
    </section>
  );
}

type InImageProps = {
  headline: string;
  disabled: boolean;
  onRegenerate?: (headline: string) => void;
};

/** Designed headlines are pixels, not a text layer; changing one means a new image. */
export function InImageHeadline({headline, disabled, onRegenerate}: InImageProps) {
  const [value, setValue] = useState(headline);
  const next = value.trim();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (next && next !== headline.trim() && !disabled) onRegenerate?.(next);
  }
  return (
    <section className={styles.headline} aria-label="Headline in the image">
      <p>
        The headline{headline ? <> “{headline}”</> : null} is part of the image, not an editable text layer.
        {onRegenerate ? ' To change it, create a new image with the headline you want.' : ' To change it, revise the image with AI.'}
      </p>
      {onRegenerate && (
        <form className={styles.headlineForm} onSubmit={submit}>
          <Field label="New headline">
            {id => <input id={id} value={value} maxLength={120} disabled={disabled} onChange={event => setValue(event.target.value)} />}
          </Field>
          <Button type="submit" disabled={disabled || !next || next === headline.trim()}>Regenerate with new headline</Button>
        </form>
      )}
    </section>
  );
}

/** Feedback sent through the normal regenerate path when only the headline should change. */
export function headlineFeedback(headline: string): string {
  return `Change the headline in the image to exactly "${headline}". Keep the layout, imagery and colours.`;
}
