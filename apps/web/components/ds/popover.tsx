"use client";
import type {ReactElement, ReactNode} from 'react';
import {Menu as BaseMenu} from '@base-ui/react/menu';
import {Popover as BasePopover} from '@base-ui/react/popover';
import {AppLink} from '../app-link';
import styles from './popover.module.css';

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';

/** Gap between the trigger and the popup, and the closest the popup may sit to the screen edge. */
const SIDE_OFFSET = 8;
const EDGE_PADDING = 12;

export interface PopoverProps {
  /** The element that opens the popover. It must render a `<button>` (for example `<Button>`). */
  trigger: ReactElement;
  children: ReactNode;
  side?: PopoverSide;
  align?: PopoverAlign;
  /** Optional heading; it also names the popover for assistive tech. */
  title?: ReactNode;
  /** Controlled open state. Leave out to let the popover manage itself. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A small glass panel anchored to its trigger, for content the user can interact with. */
export function Popover({trigger, children, side = 'bottom', align = 'center', title, open, onOpenChange}: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={next => onOpenChange?.(next)}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className={styles.positioner} side={side} align={align} sideOffset={SIDE_OFFSET} collisionPadding={EDGE_PADDING}>
          <BasePopover.Popup className={styles.popup}>
            {title ? <BasePopover.Title className={styles.title}>{title}</BasePopover.Title> : null}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

export interface MenuAction {
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  /** Renders the row as a link. `onSelect` still runs on activation. */
  href?: string;
  /** For actions that delete or cannot be undone. */
  destructive?: boolean;
  disabled?: boolean;
}
export type MenuItem = MenuAction | 'separator';

export interface MenuProps {
  /** The element that opens the menu. It must render a `<button>` (for example `<Button>`). */
  trigger: ReactElement;
  items: MenuItem[];
  align?: PopoverAlign;
}

function MenuRow({item, reserveIcon}: {item: MenuAction; reserveIcon: boolean}) {
  const content = (
    <>
      {/* When any row has an icon, every row keeps the column so labels line up. */}
      {item.icon || reserveIcon ? <span className={styles.itemIcon} aria-hidden="true">{item.icon}</span> : null}
      <span className={styles.itemLabel}>{item.label}</span>
    </>
  );
  if (item.href !== undefined && !item.disabled) {
    return (
      <BaseMenu.LinkItem className={styles.item} data-destructive={item.destructive || undefined} render={<AppLink href={item.href} />} closeOnClick onClick={() => item.onSelect?.()}>
        {content}
      </BaseMenu.LinkItem>
    );
  }
  return (
    <BaseMenu.Item className={styles.item} data-destructive={item.destructive || undefined} disabled={item.disabled} onClick={() => item.onSelect?.()}>
      {content}
    </BaseMenu.Item>
  );
}

/** A list of actions anchored to its trigger. Arrow keys, typeahead, Home/End and Escape come from Base UI. */
export function Menu({trigger, items, align = 'start'}: MenuProps) {
  const reserveIcon = items.some(item => item !== 'separator' && Boolean(item.icon));
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} align={align} sideOffset={SIDE_OFFSET} collisionPadding={EDGE_PADDING}>
          <BaseMenu.Popup className={styles.popup} data-kind="menu">
            {items.map((item, index) => item === 'separator'
              ? <BaseMenu.Separator key={index} className={styles.separator} />
              : <MenuRow key={index} item={item} reserveIcon={reserveIcon} />)}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
