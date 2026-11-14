"use client";
import {useEffect, useRef, useState} from 'react';
import {VisuallyHidden} from './a11y';

export interface AnimatedNumberProps {
  value: number;
  /** Turns the number into text. Runs on every frame, so keep it cheap. */
  format?: (value: number) => string;
  /** Length of the tween in milliseconds. */
  duration?: number;
  className?: string;
}

const DEFAULT_DURATION = 400;
const TABULAR = {fontVariantNumeric: 'tabular-nums'} as const;

const formatWhole = (value: number) => Math.round(value).toLocaleString();
/** Ease-out cubic: fast at first, settling into the final value. */
const easeOut = (progress: number) => 1 - (1 - progress) ** 3;
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts to its new value when `value` changes. The first render
 * shows the value as is. Screen readers get the final value only, never the
 * frames in between. With reduced motion the number changes at once.
 */
export function AnimatedNumber({value, format = formatWhole, duration = DEFAULT_DURATION, className}: AnimatedNumberProps) {
  const [shown, setShown] = useState(value);
  /** The number on screen right now, so a tween that is interrupted continues from where it was. */
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (Object.is(from, value)) return;
    const jump = duration <= 0 || !Number.isFinite(from) || !Number.isFinite(value) || prefersReducedMotion();
    let started: number | undefined;
    let frame = requestAnimationFrame(function step(now: number) {
      started ??= now;
      const progress = jump ? 1 : Math.min(1, (now - started) / duration);
      const next = progress === 1 ? value : from + (value - from) * easeOut(progress);
      current.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <span className={className} style={TABULAR}>
      <span aria-hidden="true">{format(shown)}</span>
      <VisuallyHidden>{format(value)}</VisuallyHidden>
    </span>
  );
}
