"use client";

import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {Button, type ButtonProps} from '@astryxdesign/core/Button';
import type {ReactNode} from 'react';

/** The prebuilt theme avoids runtime CSS generation. Desvio tokens live in design-system.css. */
export function DesignSystem({children}: {children: ReactNode}) {
  return <Theme theme={neutralTheme} mode="light">{children}</Theme>;
}

/** Preserve native form submission and existing handlers while adopting Astryx feedback. */
export function ActionButton({disabled, className = '', type = 'submit', variant, ...props}:
  Omit<ButtonProps, 'isDisabled'> & {disabled?: boolean}) {
  const classes = className.split(/\s+/);
  return <Button {...props} type={type} isDisabled={disabled}
    variant={variant ?? (classes.includes('danger') ? 'destructive' : classes.includes('primary') ? 'primary' : 'secondary')}
    className={`desvio-action ${className}`} />;
}
