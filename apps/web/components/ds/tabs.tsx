"use client";
import {useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {Radio} from '@base-ui/react/radio';
import {RadioGroup} from '@base-ui/react/radio-group';
import {Tabs as BaseTabs} from '@base-ui/react/tabs';
import styles from './tabs.module.css';
import {cx} from './cx';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Panel shown while this tab is active. Leave out on every item to use the tabs as a filter bar. */
  content?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  /** Active tab when controlled. */
  value?: string;
  /** Starting tab when uncontrolled. Defaults to the first enabled item. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  items: TabItem[];
  /** Names the tab list for assistive technology. */
  'aria-label'?: string;
  className?: string;
}

/** Views of one subject. A pill track with an indicator that slides to the active tab. */
export function Tabs({value, defaultValue, onValueChange, items, className, 'aria-label': ariaLabel}: TabsProps) {
  const initial = defaultValue ?? items.find(item => !item.disabled)?.value;
  return (
    <BaseTabs.Root
      className={cx(styles.tabs, className)}
      value={value}
      defaultValue={value === undefined ? initial : undefined}
      onValueChange={next => { if (typeof next === 'string') onValueChange?.(next); }}
    >
      <BaseTabs.List className={styles.list} aria-label={ariaLabel}>
        <BaseTabs.Indicator className={styles.indicator} />
        {items.map(item => (
          <BaseTabs.Tab key={item.value} value={item.value} disabled={item.disabled} className={styles.item}>
            <span className={styles.itemLabel}>{item.label}</span>
          </BaseTabs.Tab>
        ))}
      </BaseTabs.List>
      {items.map(item => item.content === undefined ? null : (
        <BaseTabs.Panel key={item.value} value={item.value} className={styles.panel}>{item.content}</BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
export type SegmentedControlSize = 'sm' | 'md';

export interface SegmentedControlProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  /** Names the group. Give this or `aria-labelledby`. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** `sm` is 36px tall with a 44px hit area. */
  size?: SegmentedControlSize;
  disabled?: boolean;
  className?: string;
}

interface PillRect {
  x: number;
  width: number;
}

/** Tracks the chosen segment's box so one pill can slide to it. `null` until measured. */
function usePill(value: string, optionsKey: string) {
  const group = useRef<HTMLDivElement>(null);
  const segments = useRef(new Map<string, HTMLElement>());
  const [pill, setPill] = useState<PillRect | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const active = segments.current.get(value);
      const next = active && active.offsetWidth > 0 ? {x: active.offsetLeft, width: active.offsetWidth} : null;
      setPill(current => (current?.x === next?.x && current?.width === next?.width ? current : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    if (group.current) observer.observe(group.current);
    segments.current.forEach(segment => observer.observe(segment));
    return () => observer.disconnect();
  }, [value, optionsKey]);

  return {group, segments, pill};
}

/** One choice out of a few, applied at once: a radio group drawn as a pill track. Arrow keys move the choice. */
export function SegmentedControl({value, onValueChange, options, size = 'md', disabled = false, className, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy}: SegmentedControlProps) {
  const {group, segments, pill} = usePill(value, options.map(option => option.value).join('\n'));
  return (
    <RadioGroup<string>
      ref={group}
      className={cx(styles.segmented, className)}
      value={value}
      onValueChange={next => onValueChange(next)}
      disabled={disabled}
      data-size={size}
      data-ready={pill ? '' : undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {pill && <span className={styles.thumb} style={{'--pill-x': `${pill.x}px`, '--pill-width': `${pill.width}px`} as CSSProperties} aria-hidden="true" />}
      {options.map(option => (
        <Radio.Root<string>
          key={option.value}
          ref={node => {
            if (node) segments.current.set(option.value, node);
            else segments.current.delete(option.value);
          }}
          value={option.value}
          disabled={option.disabled}
          className={styles.item}
        >
          <span className={styles.itemLabel}>{option.label}</span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
