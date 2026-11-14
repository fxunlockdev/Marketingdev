import type {CSSProperties, ComponentPropsWithoutRef, ElementType, ReactNode} from 'react';
import {cx} from './cx';
import styles from './motion.module.css';

const DEFAULT_STEP = 40;

type StepStyle = CSSProperties & {'--stagger-step': string};

type MotionProps<T extends ElementType> = {
  as?: T;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'style' | 'children'>;

export type StaggerProps<T extends ElementType> = MotionProps<T> & {
  /** Delay between one child and the next, in milliseconds. */
  step?: number;
};

/**
 * Direct children fade and rise in one after another. The stylesheet gives each child its
 * order as `--i` (0 to 9; later children enter with the tenth), so any element works as a
 * child and nothing is wrapped. Set `--i` in a child's `style` to place it by hand.
 */
export function Stagger<T extends ElementType = 'div'>({as, step = DEFAULT_STEP, className, style, children, ...props}: StaggerProps<T>) {
  const Tag: ElementType = as ?? 'div';
  const stepStyle: StepStyle = {...style, '--stagger-step': `${Math.max(0, step)}ms`};
  return <Tag className={cx(styles.stagger, className)} style={stepStyle} {...props}>{children}</Tag>;
}

export interface PageTransitionProps {
  /** Changes when the route does, for example the pathname. A new key plays the enter animation. */
  routeKey: string;
  className?: string;
  children?: ReactNode;
}

/** Fades and lifts the page content in each time `routeKey` changes. The content remounts on that change. */
export function PageTransition({routeKey, className, children}: PageTransitionProps) {
  return <div key={routeKey} className={cx(styles.page, className)}>{children}</div>;
}

/** A one-off fade and rise for a single block, played when it mounts. */
export function Reveal<T extends ElementType = 'div'>({as, className, style, children, ...props}: MotionProps<T>) {
  const Tag: ElementType = as ?? 'div';
  return <Tag className={cx(styles.reveal, className)} style={style} {...props}>{children}</Tag>;
}
