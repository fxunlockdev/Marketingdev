import type {ElementType, ReactNode} from 'react';
import {cx} from './cx';
import styles from './empty-state.module.css';

export type EmptyStateTone = 'plain' | 'card';

export interface EmptyStateProps {
  /** An icon from `./icons`. It is decorative; the title says what is empty. */
  icon?: ReactNode;
  /** A short headline that says what is missing, for example "No campaigns yet". */
  title: ReactNode;
  /** One line that says what to do next. */
  description?: ReactNode;
  /** One action: a single `Button`. */
  action?: ReactNode;
  /** `plain` sits on the page or inside a card; `card` draws its own dashed field. */
  tone?: EmptyStateTone;
  /** Heading level of the title, to fit the outline around it. */
  level?: 2 | 3 | 4;
  id?: string;
  className?: string;
}

/** What a list, table or page shows when there is nothing in it yet. The same structure everywhere. */
export function EmptyState({icon, title, description, action, tone = 'plain', level = 2, id, className}: EmptyStateProps) {
  const Title = `h${level}` as ElementType;
  return (
    <div id={id} className={cx(styles.empty, className)} data-tone={tone}>
      {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
      <Title className={styles.title}>{title}</Title>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
