import type {ComponentPropsWithoutRef, ElementType, ReactNode} from 'react';
import styles from './materials.module.css';
import {cx} from './cx';

export type GlassTier = 'thin' | 'regular' | 'thick' | 'dark';
const TIER: Record<GlassTier, string> = {thin: styles.glassThin, regular: styles.glassRegular, thick: styles.glassThick, dark: styles.glassDark};

/** Class for a frosted-glass surface. Use only on layers that float above content. */
export function glass(tier: GlassTier = 'regular'): string {
  return TIER[tier];
}

type GlassProps<T extends ElementType> = {as?: T; tier?: GlassTier; className?: string; children?: ReactNode} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

/** A frosted-glass surface with a solid fallback. */
export function Glass<T extends ElementType = 'div'>({as, tier = 'regular', className, children, ...props}: GlassProps<T>) {
  const Tag: ElementType = as ?? 'div';
  return <Tag className={cx(TIER[tier], className)} {...props}>{children}</Tag>;
}

/** Page stage: paints the ambient light once and gives glass something to blur. */
export function Stage({className, children, ...props}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cx(styles.stage, className)} {...props}>
      <div className={styles.ambient} aria-hidden="true" />
      {children}
    </div>
  );
}
