import type {ElementType, ReactNode} from 'react';
import styles from './text.module.css';
import {cx} from './cx';

interface TypeProps {
  className?: string;
  id?: string;
  children?: ReactNode;
}

export type TextTone = 'default' | 'muted';
export type TextSize = 'body' | 'callout' | 'caption';

export interface EyebrowProps extends TypeProps {
  as?: 'p' | 'span' | 'div';
  /** Set when the text sits on ink or dark glass. */
  onDark?: boolean;
}

/** The small uppercase label above a title or a group. */
export function Eyebrow({as: Tag = 'p', onDark = false, className, id, children}: EyebrowProps) {
  return <Tag id={id} className={cx(styles.eyebrow, className)} data-on-dark={onDark || undefined}>{children}</Tag>;
}

/** The largest headline, for a landing or a hero. Renders the view's `h1`. */
export function Display({className, id, children}: TypeProps) {
  return <h1 id={id} className={cx(styles.display, className)}>{children}</h1>;
}

/** The page title. One per view: use this or `Display`, never both. */
export function PageTitle({className, id, children}: TypeProps) {
  return <h1 id={id} className={cx(styles.title, className)}>{children}</h1>;
}

export interface HeadingProps extends TypeProps {
  /** The heading's place in the outline. The look stays the same. */
  level?: 2 | 3 | 4;
}

/** A section heading. */
export function Heading({level = 2, className, id, children}: HeadingProps) {
  const Tag = `h${level}` as ElementType;
  return <Tag id={id} className={cx(styles.heading, className)}>{children}</Tag>;
}

export interface SubheadingProps extends TypeProps {
  /** The heading's place in the outline. The look stays the same. */
  level?: 3 | 4 | 5;
}

/** A card or group title, one step below `Heading`. */
export function Subheading({level = 3, className, id, children}: SubheadingProps) {
  const Tag = `h${level}` as ElementType;
  return <Tag id={id} className={cx(styles.subheading, className)}>{children}</Tag>;
}

export interface TextProps extends TypeProps {
  as?: 'p' | 'span' | 'div';
  /** `muted` is for supporting copy; it still passes AA on paper and surface. */
  tone?: TextTone;
  size?: TextSize;
  /** Set when the text sits on ink or dark glass. */
  onDark?: boolean;
}

/** Running text. A paragraph by default. */
export function Text({as: Tag = 'p', tone = 'default', size = 'body', onDark = false, className, id, children}: TextProps) {
  return (
    <Tag id={id} className={cx(styles.text, className)} data-tone={tone === 'default' ? undefined : tone} data-size={size === 'body' ? undefined : size} data-on-dark={onDark || undefined}>
      {children}
    </Tag>
  );
}

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One or two sentences under the title. */
  description?: ReactNode;
  /** Buttons for the page. They sit on the right, and wrap below the title on a phone. */
  actions?: ReactNode;
  /** Sets the id of the title, for `aria-labelledby`. */
  id?: string;
  className?: string;
}

/** The top of a page: eyebrow, the one page title, a description and the page actions. */
export function PageHeader({eyebrow, title, description, actions, id, className}: PageHeaderProps) {
  return (
    <header className={cx(styles.pageHeader, className)}>
      <div className={styles.pageHeaderCopy}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <PageTitle id={id}>{title}</PageTitle>
        {description && <Text tone="muted" className={styles.pageHeaderDescription}>{description}</Text>}
      </div>
      {actions && <div className={styles.pageHeaderActions}>{actions}</div>}
    </header>
  );
}
