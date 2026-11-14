"use client";
import type {ReactElement, ReactNode} from 'react';
import {Tooltip as BaseTooltip} from '@base-ui/react/tooltip';
import styles from './tooltip.module.css';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

/** Gap between the trigger and the tooltip, and the closest it may sit to the screen edge. */
const SIDE_OFFSET = 6;
const EDGE_PADDING = 8;
/** Wait before the first tooltip shows; within `HANDOFF_MS` of one closing, the next shows at once. */
const OPEN_DELAY_MS = 500;
const HANDOFF_MS = 400;

export interface TooltipProps {
  /** A short label or hint. Keep it to text: a tooltip cannot be focused or clicked. */
  content: ReactNode;
  /** The single element the tooltip describes. It must be focusable so keyboard users get the tooltip too. */
  children: ReactElement;
  side?: TooltipSide;
  /** Milliseconds before the tooltip opens on hover. Defaults to the provider's delay. */
  delay?: number;
}

/** A dark-glass hint that names or explains the control it points at. Shows on hover and on keyboard focus. */
export function Tooltip({content, children, side = 'top', delay}: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} delay={delay} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className={styles.positioner} side={side} sideOffset={SIDE_OFFSET} collisionPadding={EDGE_PADDING}>
          <BaseTooltip.Popup className={styles.popup}>{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export interface TooltipProviderProps {
  children: ReactNode;
  /** Milliseconds before a tooltip opens on hover. */
  delay?: number;
}

/** Mount once near the root. Tooltips under it share one delay, and moving between neighbours shows the next one at once. */
export function TooltipProvider({children, delay = OPEN_DELAY_MS}: TooltipProviderProps) {
  return <BaseTooltip.Provider delay={delay} timeout={HANDOFF_MS}>{children}</BaseTooltip.Provider>;
}
