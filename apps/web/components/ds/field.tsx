"use client";
import {createContext, useContext, useId, useMemo} from 'react';
import type {ComponentProps, MouseEvent, ReactNode} from 'react';
import styles from './field.module.css';
import {cx} from './cx';
import {AlertIcon} from './icons';

/** What a control inside a `Field` needs to tie itself to the label and the message. */
export interface FieldControl {
  id: string;
  /** Id of the hint or error text, when there is one. */
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** Field wiring for the control being rendered, or `null` outside a `Field`. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

const hasContent = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false && node !== '';
const joinIds = (...ids: Array<string | undefined>): string | undefined => ids.filter(Boolean).join(' ') || undefined;

export interface FieldProps {
  label: ReactNode;
  /** Helper text under the control. `error` replaces it. */
  hint?: ReactNode;
  /** Validation message. Marks the control invalid and is announced when it appears. */
  error?: ReactNode;
  /** Marks the label and sets `aria-required` on the control. */
  required?: boolean;
  /** One control: `Input`, `Textarea` or `Select`. It picks up id, description and validity itself. */
  children: ReactNode;
  /** Id for the control, when a fixed one is needed. Set it here, not on the control, so the label keeps pointing at it. */
  id?: string;
  className?: string;
}

/** Label above, control, then a hint or an error. */
export function Field({label, hint, error, required = false, children, id: controlId, className}: FieldProps) {
  const base = useId();
  const id = controlId ?? `${base}-control`;
  const messageId = `${base}-message`;
  const invalid = hasContent(error);
  const described = invalid || hasContent(hint);
  const control = useMemo<FieldControl>(() => ({id, describedBy: described ? messageId : undefined, invalid, required}), [id, messageId, described, invalid, required]);
  return (
    <div className={cx(styles.field, className)} data-invalid={invalid || undefined}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required && <span className={styles.required} aria-hidden="true">*</span>}
      </label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {invalid ? (
        <span id={messageId} role="alert" className={styles.error}>
          <AlertIcon className={styles.errorIcon} />
          <span>{error}</span>
        </span>
      ) : described ? (
        <span id={messageId} className={styles.hint}>{hint}</span>
      ) : null}
    </div>
  );
}

/** A press on the padding or an adornment lands in the control, as it would on a native field. */
function focusControl(event: MouseEvent<HTMLElement>) {
  if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [tabindex]')) return;
  event.preventDefault();
  event.currentTarget.querySelector<HTMLElement>('input, textarea')?.focus();
}

export type InputProps = ComponentProps<'input'> & {
  /** Danger edge and focus ring. Defaults to the surrounding `Field`'s error state. */
  invalid?: boolean;
  /** Icon or short text before the value. */
  leading?: ReactNode;
  /** Icon, unit or a small button after the value. */
  trailing?: ReactNode;
};

/** Single-line text field. `className` styles the outer control; everything else reaches the `<input>`. */
export function Input({invalid, leading, trailing, className, id, disabled, readOnly, 'aria-describedby': describedBy, ...props}: InputProps) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const hasLeading = hasContent(leading);
  const hasTrailing = hasContent(trailing);
  return (
    <span className={cx(styles.control, className)} data-invalid={isInvalid || undefined} data-disabled={disabled || undefined} data-readonly={readOnly || undefined} onMouseDown={focusControl}>
      {hasLeading && <span className={styles.adornment} data-side="leading">{leading}</span>}
      <input
        aria-required={field?.required || undefined}
        {...props}
        className={styles.input}
        id={id ?? field?.id}
        disabled={disabled}
        readOnly={readOnly}
        data-leading={hasLeading || undefined}
        data-trailing={hasTrailing || undefined}
        aria-invalid={isInvalid || undefined}
        aria-describedby={joinIds(describedBy, field?.describedBy)}
      />
      {hasTrailing && <span className={styles.adornment} data-side="trailing">{trailing}</span>}
    </span>
  );
}

export type TextareaProps = ComponentProps<'textarea'> & {
  /** Danger edge and focus ring. Defaults to the surrounding `Field`'s error state. */
  invalid?: boolean;
};

/** Multi-line text field: at least three rows, resizable vertically. */
export function Textarea({invalid, className, id, disabled, readOnly, rows = 3, 'aria-describedby': describedBy, ...props}: TextareaProps) {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return (
    <span className={cx(styles.control, className)} data-multiline data-invalid={isInvalid || undefined} data-disabled={disabled || undefined} data-readonly={readOnly || undefined} onMouseDown={focusControl}>
      <textarea
        aria-required={field?.required || undefined}
        {...props}
        className={styles.input}
        id={id ?? field?.id}
        rows={Math.max(3, rows)}
        disabled={disabled}
        readOnly={readOnly}
        data-multiline
        aria-invalid={isInvalid || undefined}
        aria-describedby={joinIds(describedBy, field?.describedBy)}
      />
    </span>
  );
}
