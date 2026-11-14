"use client";
import {useLayoutEffect, useRef, useState} from 'react';
import {Select as BaseSelect} from '@base-ui/react/select';
import styles from './select.module.css';
import {cx} from './cx';
import {useFieldControl} from './field';
import {CheckIcon, ChevronDownIcon} from './icons';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export type SelectSize = 'sm' | 'md';

export interface SelectProps {
  /** The chosen value. `null`, or a value that is not in `options`, shows the placeholder. Leave out to keep the select uncontrolled. */
  value?: string | null;
  /** Starting value when uncontrolled. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Danger edge and focus ring. Defaults to the surrounding `Field`'s error state. */
  invalid?: boolean;
  /** `sm` is 36px tall with a 44px hit area. */
  size?: SelectSize;
  /** Required when the select has no `Field` label. */
  'aria-label'?: string;
  /** Id of the trigger button. Defaults to the surrounding `Field`'s control id. */
  id?: string;
  /** Submits the value with a form through a hidden input. */
  name?: string;
  className?: string;
}

/** Gap between the trigger and its menu, in px: one step of `--space-2`. */
const MENU_OFFSET = 8;

/** Single-choice menu. Base UI owns the keyboard, typeahead, focus and collision handling. */
export function Select({value, defaultValue, onValueChange, options, placeholder = 'Select', disabled = false, invalid, size = 'md', id, name, className, 'aria-label': ariaLabel}: SelectProps) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const selected = value === undefined ? undefined : options.some(option => option.value === value) ? value : null;
  // A native modal <dialog> sits in the top layer: a menu portalled to <body> would open behind it and be inert.
  const root = useRef<HTMLSpanElement>(null);
  const [dialog, setDialog] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setDialog(root.current?.closest('dialog') ?? null), []);
  return (
    <span ref={root} className={cx(styles.root, className)}>
      <BaseSelect.Root<string>
        id={id ?? field?.id}
        name={name}
        value={selected}
        defaultValue={defaultValue}
        onValueChange={next => { if (next !== null) onValueChange?.(next); }}
        items={options}
        disabled={disabled}
        modal={false}
      >
        <BaseSelect.Trigger
          className={styles.trigger}
          data-size={size}
          data-invalid={isInvalid || undefined}
          aria-label={ariaLabel}
          aria-invalid={isInvalid || undefined}
          aria-describedby={field?.describedBy}
          aria-required={field?.required || undefined}
        >
          {size === 'sm' && <span className={styles.hit} aria-hidden="true" />}
          <BaseSelect.Value className={styles.value} placeholder={placeholder} />
          <BaseSelect.Icon className={styles.chevron}><ChevronDownIcon /></BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal container={dialog ?? undefined}>
          <BaseSelect.Positioner className={styles.positioner} sideOffset={MENU_OFFSET} align="start" alignItemWithTrigger={false} collisionBoundary={dialog ?? undefined}>
            <BaseSelect.Popup className={styles.popup}>
              <BaseSelect.List className={styles.list}>
                {options.map(option => (
                  <BaseSelect.Item key={option.value} value={option.value} disabled={option.disabled} className={styles.option}>
                    <BaseSelect.ItemText className={styles.optionLabel}>{option.label}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className={styles.check} keepMounted><CheckIcon /></BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </span>
  );
}
