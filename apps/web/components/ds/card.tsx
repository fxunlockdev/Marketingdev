import type {ComponentPropsWithoutRef, ElementType, ReactNode} from 'react';
import styles from './card.module.css';
import {cx} from './cx';
import {glass} from './materials';

export type CardTone = 'surface' | 'muted' | 'accent' | 'inverse';
export type CardPadding = 'default' | 'compact' | 'none';

type CardProps<T extends ElementType> = {
  as?: T;
  /** `inverse` is the dark-glass emphasis surface; use it at most once per view. */
  tone?: CardTone;
  padding?: CardPadding;
  /** Adds hover, press and focus states for a card that is one link or button. */
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/** A solid content surface with one radius, one border and one resting shadow. */
export function Card<T extends ElementType = 'div'>({as, tone = 'surface', padding = 'default', interactive = false, className, children, ...props}: CardProps<T>) {
  const Tag: ElementType = as ?? 'div';
  return (
    <Tag className={cx(styles.card, tone === 'inverse' && glass('dark'), className)} data-tone={tone} data-padding={padding === 'default' ? undefined : padding} data-interactive={interactive || undefined} {...props}>
      {children}
    </Tag>
  );
}

/** Card title row: a heading, an optional one-line description and an optional action on the right. */
export function CardHeader({title, description, action, level = 2, id}: {title: ReactNode; description?: ReactNode; action?: ReactNode; level?: 2 | 3 | 4; id?: string}) {
  const Heading = `h${level}` as ElementType;
  return (
    <header className={styles.header}>
      <div>
        <Heading id={id} className={styles.title}>{title}</Heading>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {action}
    </header>
  );
}
