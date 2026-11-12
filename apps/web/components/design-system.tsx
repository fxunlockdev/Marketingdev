"use client";

import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {Button, type ButtonProps} from '@astryxdesign/core/Button';
import type {ReactNode} from 'react';

/** The prebuilt theme avoids runtime CSS generation. Desvio tokens live in app/tokens.css. */
export function DesignSystem({children}: {children: ReactNode}) {
  return <Theme theme={neutralTheme} mode="light">{children}</Theme>;
}

/**
 * Legacy call-site API (149 uses): the variant is read from the class list and
 * the default type stays `submit`. New code uses `Button` from ./ui/button.
 */
export function ActionButton({disabled, className = '', type = 'submit', variant, ...props}:
  Omit<ButtonProps, 'isDisabled'> & {disabled?: boolean}) {
  const classes = className.split(/\s+/);
  const fromClass = classes.includes('danger') ? 'destructive' : classes.includes('primary') ? 'primary'
    : classes.includes('quiet') ? 'ghost' : 'secondary';
  return <Button {...props} type={type} isDisabled={disabled}
    variant={variant ?? fromClass}
    className={`desvio-action ${className}`} />;
}
