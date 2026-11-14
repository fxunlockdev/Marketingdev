"use client";
import {useLayoutEffect, useRef, type ReactNode} from 'react';
import {AppLink} from '../app-link';
import styles from './nav.module.css';
import {cx} from './cx';

interface NavProps {
  'aria-label': string;
  /** Changes whenever the active item changes (e.g. the pathname), so the pill re-measures. */
  activeKey?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Navigation list. One pill sits behind the item marked `aria-current="page"` and
 * slides to the next one with a spring when the active item changes.
 */
export function Nav({'aria-label': label, activeKey, children, className, id}: NavProps) {
  const root = useRef<HTMLElement>(null), pill = useRef<HTMLSpanElement>(null), placed = useRef(false);
  useLayoutEffect(() => {
    const nav = root.current, mark = pill.current;
    if (!nav || !mark) return;
    const place = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) { mark.removeAttribute('data-ready'); placed.current = false; return; }
      const box = active.getBoundingClientRect(), frame = nav.getBoundingClientRect();
      // The first placement, and any placement after a resize, must not animate from a stale position.
      if (!placed.current) mark.setAttribute('data-instant', '');
      mark.style.setProperty('--pill-y', `${box.top - frame.top}px`);
      mark.style.setProperty('--pill-h', `${box.height}px`);
      mark.setAttribute('data-ready', '');
      if (!placed.current) { void mark.offsetHeight; mark.removeAttribute('data-instant'); placed.current = true; }
    };
    place();
    const resize = new ResizeObserver(() => { placed.current = false; place(); });
    resize.observe(nav);
    return () => resize.disconnect();
  }, [activeKey]);
  return (
    <nav ref={root} id={id} aria-label={label} className={cx(styles.nav, className)}>
      <span ref={pill} className={styles.pill} aria-hidden="true" />
      {children}
    </nav>
  );
}

/** A labelled group of navigation items. */
export function NavSection({label, children}: {label?: string; children: ReactNode}) {
  return (
    <div>
      {label && <p className={styles.sectionLabel}>{label}</p>}
      <ul className={styles.section}>{children}</ul>
    </div>
  );
}

interface NavItemProps {
  href: string;
  icon?: ReactNode;
  active?: boolean;
  /** Count or badge shown at the end of the row. */
  trailing?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}

/** One navigation row. `active` sets `aria-current="page"`, which the pill follows. */
export function NavItem({href, icon, active = false, trailing, children, onClick}: NavItemProps) {
  return (
    <li>
      <AppLink href={href} className={styles.item} aria-current={active ? 'page' : undefined} onClick={onClick}>
        {icon && <span className={styles.icon} aria-hidden="true">{icon}</span>}
        <span className={styles.label}>{children}</span>
        {trailing && <span className={styles.trailing}>{trailing}</span>}
      </AppLink>
    </li>
  );
}
