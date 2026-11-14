import type {CSSProperties, ReactNode} from 'react';
import {VisuallyHidden} from './a11y';
import {Card} from './card';
import {cx} from './cx';
import styles from './skeleton.module.css';

export type SkeletonRadius = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface SkeletonProps {
  /** Any CSS length or percentage; a number is pixels. Defaults to the full width. */
  width?: CSSProperties['width'];
  /** Any CSS length; a number is pixels. Defaults to one line of text (1em). */
  height?: CSSProperties['height'];
  /** A step of the radius scale. Match the shape the block stands in for. */
  radius?: SkeletonRadius;
  className?: string;
}

/** One placeholder block. Put skeletons inside a `SkeletonGroup` so the wait is announced. */
export function Skeleton({width, height, radius = 'sm', className}: SkeletonProps) {
  const style = width === undefined && height === undefined ? undefined : {width, height};
  return <span className={cx(styles.skeleton, className)} data-radius={radius === 'sm' ? undefined : radius} style={style} aria-hidden="true" />;
}

export interface SkeletonTextProps {
  /** How many lines to draw. The last one is shorter, as a paragraph ends. */
  lines?: number;
  className?: string;
}

/** Placeholder for a paragraph. */
export function SkeletonText({lines = 3, className}: SkeletonTextProps) {
  const count = Math.max(1, Math.floor(lines));
  return (
    <span className={cx(styles.lines, className)} aria-hidden="true">
      {Array.from({length: count}, (_, index) => <Skeleton key={index} className={styles.line} />)}
    </span>
  );
}

/** Placeholder with the shape of a Card: a title bar, two lines and a button-shaped pill. */
export function SkeletonCard({className}: {className?: string}) {
  return (
    <Card className={className} aria-hidden="true">
      <span className={styles.cardBody}>
        <Skeleton className={styles.cardTitle} />
        <SkeletonText lines={2} />
        <Skeleton className={styles.cardAction} radius="full" />
      </span>
    </Card>
  );
}

export interface SkeletonGroupProps {
  /** What a screen reader hears while the content loads. */
  label?: string;
  className?: string;
  children?: ReactNode;
}

/** Wraps a set of skeletons in one polite status, so "Loading" is said once and the shapes stay silent. */
export function SkeletonGroup({label = 'Loading', className, children}: SkeletonGroupProps) {
  return (
    <div className={cx(styles.group, className)} role="status">
      <VisuallyHidden>{label}</VisuallyHidden>
      {children}
    </div>
  );
}
