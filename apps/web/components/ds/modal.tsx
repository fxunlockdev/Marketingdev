"use client";
import type {ReactNode} from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {Button} from './button';
import {CloseIcon} from './icons';
import styles from './modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg';
export type DrawerSide = 'right' | 'left';

interface OverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dialog for assistive tech; always visible. */
  title: ReactNode;
  description?: ReactNode;
  /** Scrolls inside the popup when it is taller than the screen. */
  children?: ReactNode;
  /** Action buttons, right-aligned. Put the primary action last. */
  footer?: ReactNode;
}

export interface ModalProps extends OverlayProps {
  /** Max width: sm 400px, md 520px, lg 720px. */
  size?: ModalSize;
  /** When false there is no close button, and Escape and outside presses do nothing: the footer must close it. */
  dismissible?: boolean;
}

export interface DrawerProps extends OverlayProps {
  side?: DrawerSide;
}

/** How long a pointer press stays the likely cause of a modal opening. */
const PRESS_WINDOW_MS = 1500;
const CONTROL = 'button, a, input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [tabindex]';

/* Safari does not focus a button on click, so focus alone cannot find the control
   that opened a modal. Remember the last control pressed with a pointer as well. */
let lastPress: {control: Element; at: number} | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', event => {
    const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
    lastPress = control ? {control, at: performance.now()} : null;
  }, {capture: true, passive: true});
  document.addEventListener('keydown', () => { lastPress = null; }, {capture: true, passive: true});
}

/** Popups that already have an origin; one measurement per open. */
const aimed = new WeakSet<HTMLElement>();

/** Viewport centre of the control that opened the popup: the last press, else the focused element. */
function openerCentre(popup: HTMLElement): {x: number; y: number} | null {
  const pressed = lastPress && performance.now() - lastPress.at < PRESS_WINDOW_MS && lastPress.control.isConnected ? lastPress.control : null;
  const focused = document.activeElement;
  const opener = pressed ?? (focused && focused !== document.body && !popup.contains(focused) ? focused : null);
  if (!opener) return null;
  const box = opener.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return {x: box.left + box.width / 2, y: box.top + box.height / 2};
}

/** Ref for the modal popup. Runs as it mounts, before Base UI moves focus inside, and points
 *  its transform-origin at the opener, measured against the popup's untransformed layout box. */
function aimAtOpener(popup: HTMLDivElement | null) {
  if (!popup || aimed.has(popup)) return;
  aimed.add(popup);
  const centre = openerCentre(popup);
  if (!centre) return;
  const frame = popup.offsetParent?.getBoundingClientRect();
  popup.style.setProperty('--modal-origin-x', `${centre.x - (frame?.left ?? 0) - popup.offsetLeft}px`);
  popup.style.setProperty('--modal-origin-y', `${centre.y - (frame?.top ?? 0) - popup.offsetTop}px`);
}

interface SheetProps extends OverlayProps {
  variant: 'modal' | 'drawer';
  size?: ModalSize;
  side?: DrawerSide;
  dismissible: boolean;
}

function Sheet({open, onOpenChange, title, description, children, footer, variant, size, side, dismissible}: SheetProps) {
  return (
    <Dialog.Root
      open={open}
      disablePointerDismissal={!dismissible}
      onOpenChange={(next, details) => {
        if (!next && !dismissible) { details.cancel(); return; }
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Viewport className={styles.viewport} data-variant={variant} data-side={side}>
          <Dialog.Popup ref={variant === 'modal' ? aimAtOpener : undefined} className={styles.popup} data-variant={variant} data-size={size} data-side={side}>
            <div className={styles.header}>
              <div className={styles.heading}>
                <Dialog.Title className={styles.title}>{title}</Dialog.Title>
                {description ? <Dialog.Description className={styles.description}>{description}</Dialog.Description> : null}
              </div>
              {dismissible && <Dialog.Close render={<Button variant="ghost" size="sm" icon={<CloseIcon />} aria-label="Close" className={styles.close} />} />}
            </div>
            {children !== undefined && children !== null && <div className={styles.body}>{children}</div>}
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A centred dialog that grows out of the control that opened it. A bottom sheet on phones. */
export function Modal({size = 'md', dismissible = true, ...props}: ModalProps) {
  return <Sheet {...props} variant="modal" size={size} dismissible={dismissible} />;
}

/** A full-height panel that slides in from one edge, for detail and editing beside the page. A bottom sheet on phones. */
export function Drawer({side = 'right', ...props}: DrawerProps) {
  return <Sheet {...props} variant="drawer" side={side} dismissible />;
}
