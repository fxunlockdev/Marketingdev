"use client";
import type {ReactNode} from 'react';
import {Checkbox as BaseCheckbox} from '@base-ui/react/checkbox';
import {Switch as BaseSwitch} from '@base-ui/react/switch';
import styles from './toggle.module.css';
import {cx} from './cx';
import {CheckIcon, MinusIcon} from './icons';

interface ToggleProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Label text to the right. The whole row toggles the control. */
  children?: ReactNode;
  /** Required when there is no label text. */
  'aria-label'?: string;
  /** Submits with a form through a hidden input. */
  name?: string;
  id?: string;
  className?: string;
}

const hasLabel = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false && node !== '';

export type SwitchProps = ToggleProps;

/** On/off setting that applies immediately. Use Checkbox for a choice that is submitted later. */
export function Switch({checked, defaultChecked, onCheckedChange, disabled = false, children, className, ...rest}: SwitchProps) {
  const labelled = hasLabel(children);
  return (
    <label className={cx(styles.row, className)} data-disabled={disabled || undefined} data-bare={!labelled || undefined}>
      <BaseSwitch.Root {...rest} className={styles.track} checked={checked} defaultChecked={defaultChecked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <BaseSwitch.Thumb className={styles.thumb} />
      </BaseSwitch.Root>
      {labelled && <span className={styles.text}>{children}</span>}
    </label>
  );
}

export interface CheckboxProps extends ToggleProps {
  /** Mixed state for a parent of partly chosen items. Shows a dash instead of the tick. */
  indeterminate?: boolean;
}

/** A choice that is submitted with a form, or one of several that can be chosen together. */
export function Checkbox({checked, defaultChecked, indeterminate = false, onCheckedChange, disabled = false, children, className, ...rest}: CheckboxProps) {
  const labelled = hasLabel(children);
  return (
    <label className={cx(styles.row, className)} data-disabled={disabled || undefined} data-bare={!labelled || undefined}>
      <BaseCheckbox.Root {...rest} className={styles.box} checked={checked} defaultChecked={defaultChecked} indeterminate={indeterminate} onCheckedChange={onCheckedChange} disabled={disabled}>
        <BaseCheckbox.Indicator className={styles.mark}>
          {indeterminate ? <MinusIcon /> : <CheckIcon />}
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {labelled && <span className={styles.text}>{children}</span>}
    </label>
  );
}
