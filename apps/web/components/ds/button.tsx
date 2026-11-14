"use client";
import type {ComponentProps, ReactNode} from 'react';
import {AppLink} from '../app-link';
import styles from './button.module.css';
import {cx} from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonOwnProps {
  /** One primary per view; everything else steps down to secondary or ghost. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks repeat presses. */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the container's width. */
  block?: boolean;
  /** Leading icon. With no children the button is icon-only and needs `aria-label`. */
  icon?: ReactNode;
  iconEnd?: ReactNode;
  /** Set when the button sits on ink or dark glass. */
  onDark?: boolean;
  children?: ReactNode;
  className?: string;
}

type AsButton = ButtonOwnProps & Omit<ComponentProps<'button'>, keyof ButtonOwnProps> & {href?: undefined};
type AsLink = ButtonOwnProps & Omit<ComponentProps<typeof AppLink>, keyof ButtonOwnProps | 'href'> & {href: string};
export type ButtonProps = AsButton | AsLink;

/** The one button. Renders a link when `href` is set; `type` defaults to "button". */
export function Button(props: ButtonProps) {
  const {variant = 'primary', size = 'md', loading = false, disabled = false, block = false, icon, iconEnd, onDark = false, children, className, ...rest} = props;
  const inactive = disabled || loading;
  const shared = {
    className: cx(styles.button, className),
    'data-variant': variant,
    'data-size': size,
    'data-loading': loading || undefined,
    'data-block': block || undefined,
    'data-on-dark': onDark || undefined,
    'data-icon-only': children === undefined || children === null ? true : undefined,
    'aria-busy': loading || undefined,
  };
  const content = (
    <>
      {size === 'sm' && <span className={styles.hit} aria-hidden="true" />}
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      {children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
      {iconEnd ? <span className={styles.icon} aria-hidden="true">{iconEnd}</span> : null}
    </>
  );
  if (rest.href !== undefined) {
    const {href, onClick, ...link} = rest as Omit<AsLink, keyof ButtonOwnProps>;
    return (
      <AppLink
        {...link}
        {...shared}
        href={href}
        aria-disabled={inactive || undefined}
        tabIndex={inactive ? -1 : link.tabIndex}
        onClick={event => { if (inactive) event.preventDefault(); else onClick?.(event); }}
      >
        {content}
      </AppLink>
    );
  }
  const {type = 'button', ...button} = rest as Omit<AsButton, keyof ButtonOwnProps>;
  return (
    <button {...button} {...shared} type={type} disabled={inactive}>
      {content}
    </button>
  );
}
