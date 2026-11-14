import type {ReactNode} from 'react';
import {VisuallyHidden} from './a11y';
import styles from './badge.module.css';
import {cx} from './cx';

export type BadgeTone = 'neutral' | 'info' | 'positive' | 'caution' | 'danger' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  /** A leading dot in the text colour. The label still carries the meaning. */
  dot?: boolean;
  /** The status in words. Colour alone never says it. */
  children: ReactNode;
  className?: string;
}

/** A status pill: a short label on its status wash. Not interactive. */
export function Badge({tone = 'neutral', dot = false, children, className}: BadgeProps) {
  return (
    <span className={cx(styles.badge, className)} data-tone={tone} data-dot={dot || undefined}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

export type CountBadgeTone = 'neutral' | 'accent';

export interface CountBadgeProps {
  count: number;
  /** Counts above this show as `max+`. */
  max?: number;
  /** `accent` is for a count that asks for attention, such as unread items. */
  tone?: CountBadgeTone;
  /** What a screen reader says instead of the bare number, for example "12 unread". */
  label?: string;
  /** Render a zero. By default a count of zero renders nothing. */
  showZero?: boolean;
  className?: string;
}

/** A small rounded count for tabs, nav items and list headers. */
export function CountBadge({count, max = 99, tone = 'neutral', label, showZero = false, className}: CountBadgeProps) {
  if (!Number.isFinite(count) || count < 0 || (count === 0 && !showZero)) return null;
  const whole = Math.floor(count);
  const text = whole > max ? `${max}+` : String(whole);
  return (
    <span className={cx(styles.count, className)} data-tone={tone}>
      {label === undefined ? text : <><span aria-hidden="true">{text}</span><VisuallyHidden>{label}</VisuallyHidden></>}
    </span>
  );
}
