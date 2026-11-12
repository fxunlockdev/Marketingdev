"use client";

import {Button as AstryxButton, type ButtonProps as AstryxButtonProps} from '@astryxdesign/core/Button';
import type {ReactNode} from 'react';
import {AppLink} from '../app-link';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const astryxVariant: Record<ButtonVariant, NonNullable<AstryxButtonProps['variant']>> = {
  primary: 'primary',
  secondary: 'secondary',
  quiet: 'ghost',
  danger: 'destructive',
};

export type ButtonProps = Omit<AstryxButtonProps, 'variant' | 'size' | 'isDisabled' | 'isLoading' | 'label' | 'as'> & {
  /** Accessible name. Defaults to the visible text when `children` is a string. */
  label?: string;
  children?: ReactNode;
  /** One primary per view; everything else is secondary, quiet or danger. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks repeat presses. */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the width of the container (forms, narrow screens). */
  block?: boolean;
};

/**
 * The one button for Desvio. Wraps the Astryx Button so loading, disabled and
 * link behaviour come from the design system, and Desvio's look comes from
 * tokens (`.desvio-action` in app/design-system.css).
 *
 * Every size keeps a 44px touch target: `sm` is visually 36px with an
 * extended hit area.
 */
export function Button({
  variant = 'secondary', size = 'md', loading = false, disabled = false, block = false,
  type = 'button', className = '', label, children, href, ...props
}: ButtonProps) {
  const name = label ?? (typeof children === 'string' ? children : '');
  return (
    <AstryxButton
      {...props}
      type={type}
      label={name}
      href={href}
      as={href ? AppLink : undefined}
      variant={astryxVariant[variant]}
      isLoading={loading}
      isDisabled={disabled}
      data-size={size}
      data-block={block ? 'true' : undefined}
      className={`desvio-action ui-button ${className}`.trim()}
    >
      {children}
    </AstryxButton>
  );
}
