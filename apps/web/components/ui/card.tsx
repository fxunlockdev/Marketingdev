"use client";

import {Card as AstryxCard, type CardProps as AstryxCardProps} from '@astryxdesign/core/Card';

export type CardTone = 'surface' | 'muted' | 'accent' | 'inverse';
export type CardElevation = 'flat' | 'low' | 'raised';

const astryxElevation: Record<CardElevation, NonNullable<AstryxCardProps['elevation']>> = {
  flat: 'none', low: 'low', raised: 'med',
};

export type CardProps = Omit<AstryxCardProps, 'variant' | 'elevation' | 'padding'> & {
  /** `inverse` is the ink surface; use it for at most one card per view. */
  tone?: CardTone;
  elevation?: CardElevation;
  /** Adds hover, focus-within and pressed states for cards that are one link. */
  interactive?: boolean;
};

/**
 * A surface with one radius, one border and one of three elevations. Pass
 * `role="region"` with `aria-labelledby` when the card is a page landmark.
 */
export function Card({tone = 'surface', elevation = 'flat', interactive = false, className = '', ...props}: CardProps) {
  return (
    <AstryxCard
      {...props}
      variant={tone === 'muted' ? 'muted' : 'default'}
      elevation={astryxElevation[elevation]}
      data-tone={tone}
      data-elevation={elevation}
      data-interactive={interactive ? 'true' : undefined}
      className={`ui-card ${className}`.trim()}
    />
  );
}
