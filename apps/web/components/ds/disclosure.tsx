"use client";
import type {ReactNode} from 'react';
import {Collapsible} from '@base-ui/react/collapsible';
import styles from './disclosure.module.css';
import {ChevronDownIcon} from './icons';

export interface DisclosureProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state. Leave out to let the disclosure manage itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Quiet detail on the right of the row, such as a count. */
  meta?: ReactNode;
}

/** A row that shows or hides the content beneath it. The content is removed from the page while closed. */
export function Disclosure({title, children, defaultOpen = false, open, onOpenChange, meta}: DisclosureProps) {
  return (
    <Collapsible.Root className={styles.disclosure} defaultOpen={defaultOpen} open={open} onOpenChange={next => onOpenChange?.(next)}>
      <Collapsible.Trigger className={styles.trigger}>
        <span className={styles.title}>{title}</span>
        {meta !== undefined && meta !== null && <span className={styles.meta}>{meta}</span>}
        <span className={styles.chevron} aria-hidden="true"><ChevronDownIcon /></span>
      </Collapsible.Trigger>
      <Collapsible.Panel className={styles.panel}>
        <div className={styles.content}>{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
