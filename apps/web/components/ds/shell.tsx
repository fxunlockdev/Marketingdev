"use client";
import {useState, useSyncExternalStore, type ReactNode} from 'react';
import styles from './shell.module.css';
import {cx} from './cx';
import {Button} from './button';
import {Drawer} from './modal';
import {Menu, type MenuItem} from './popover';
import {CheckIcon, ChevronDownIcon} from './icons';

const NARROW = '(max-width: 56.25rem)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
/** True on phones and small tablets, where the sidebar lives in a drawer. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches, () => false);
}

function MenuGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      <path d="M3.5 6.5h13M3.5 10h13M3.5 13.5h13" />
    </svg>
  );
}

interface AppShellProps {
  /** Logo or wordmark at the top of the sidebar. */
  brand: ReactNode;
  /** Business switcher and anything else pinned above the navigation. */
  sidebarHead?: ReactNode;
  /** The navigation (a `Nav`). */
  navigation: ReactNode;
  /** Account block pinned to the bottom of the sidebar. */
  sidebarFoot?: ReactNode;
  /** Left side of the top bar: where the person is. */
  topbarLeading?: ReactNode;
  /** Right side of the top bar: credits, the Create action. */
  topbarTrailing?: ReactNode;
  children: ReactNode;
}

/**
 * The frame every signed-in page sits in: a floating glass sidebar, a floating
 * glass top bar and solid content. On narrow screens the sidebar moves into a
 * drawer opened from the top bar, so it is only ever rendered once.
 */
export function AppShell({brand, sidebarHead, navigation, sidebarFoot, topbarLeading, topbarTrailing, children}: AppShellProps) {
  const narrow = useNarrow(), [menuOpen, setMenuOpen] = useState(false);
  const sidebar = (
    <>
      {sidebarHead && <div className={styles.sidebarHead}>{sidebarHead}</div>}
      <div className={styles.sidebarBody}>{navigation}</div>
      {sidebarFoot && <div className={styles.sidebarFoot}>{sidebarFoot}</div>}
    </>
  );
  return (
    <div className={styles.shell}>
      {!narrow && (
        <aside className={styles.sidebar}>
          <div className={styles.brand}>{brand}</div>
          {sidebar}
        </aside>
      )}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeading}>
            {narrow && <Button variant="ghost" size="sm" icon={<MenuGlyph />} aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} />}
            {topbarLeading}
          </div>
          {topbarTrailing && <div className={styles.topbarTrailing}>{topbarTrailing}</div>}
        </header>
        <main id="main" className={styles.content}>{children}</main>
      </div>
      {narrow && (
        <Drawer open={menuOpen} onOpenChange={setMenuOpen} title={brand} side="left">
          {/* Choosing a destination closes the drawer. */}
          <div className={styles.drawerBody} onClick={event => { if ((event.target as HTMLElement).closest('a')) setMenuOpen(false); }}>{sidebar}</div>
        </Drawer>
      )}
    </div>
  );
}

export interface SwitcherBusiness {
  id: string;
  name: string;
}

interface BusinessSwitcherProps {
  businesses: SwitcherBusiness[];
  /** Selected business id, or '' for all businesses. */
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
}

/** The business switcher: the whole card is the control, and the menu lines up with it. */
export function BusinessSwitcher({businesses, value, onChange, allLabel = 'All businesses'}: BusinessSwitcherProps) {
  const current = businesses.find(b => b.id === value), name = current?.name ?? allLabel;
  const body = (
    <>
      <span className={styles.switcherInitial} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <span className={styles.switcherText}>
        <span className={styles.switcherLabel}>Business</span>
        <span className={styles.switcherName}>{name}</span>
      </span>
    </>
  );
  if (businesses.length < 2) return <div className={cx(styles.switcher, styles.switcherStatic)}>{body}</div>;
  const tick = (id: string) => (id === value ? <CheckIcon /> : undefined);
  const items: MenuItem[] = [
    {label: allLabel, icon: tick(''), onSelect: () => onChange('')},
    'separator',
    ...businesses.map<MenuItem>(b => ({label: b.name, icon: tick(b.id), onSelect: () => onChange(b.id)})),
  ];
  return (
    <Menu
      align="start"
      items={items}
      trigger={
        <button type="button" className={styles.switcher} aria-label={`Business: ${name}`}>
          {body}
          <ChevronDownIcon className={styles.switcherChevron} />
        </button>
      }
    />
  );
}
