import type {ReactNode} from 'react';
import styles from './a11y.module.css';

/** Class for text that only screen readers should get. */
export const visuallyHidden: string = styles.visuallyHidden;

export interface VisuallyHiddenProps {
  /** Use `div` when the hidden content holds block elements. */
  as?: 'span' | 'div';
  id?: string;
  children?: ReactNode;
}

/** Text for screen readers only: labels for icon-only UI, loading states, final values. */
export function VisuallyHidden({as: Tag = 'span', id, children}: VisuallyHiddenProps) {
  return <Tag id={id} className={styles.visuallyHidden}>{children}</Tag>;
}
