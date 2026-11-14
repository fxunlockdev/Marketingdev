"use client";
import {createContext, useContext, useMemo} from 'react';
import type {ReactNode} from 'react';
import {Toast as BaseToast} from '@base-ui/react/toast';
import {Button} from './button';
import {AlertIcon, CloseIcon, InfoIcon, SuccessIcon} from './icons';
import styles from './toast.module.css';

export type ToastTone = 'neutral' | 'positive' | 'caution' | 'danger';

export interface ToastAction {
  label: string;
  /** Runs when the action is pressed; the toast then closes. */
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: ToastAction;
  /** Milliseconds before the toast closes by itself. 0 keeps it until dismissed. Defaults to 5000. */
  duration?: number;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  /** Closes one toast, or every toast when no id is given. */
  dismiss: (id?: string) => void;
}

/** Toasts shown at once; older ones fade out behind the stack. */
const VISIBLE_LIMIT = 3;
const TONE_ICON: Record<ToastTone, ReactNode> = {
  neutral: <InfoIcon />,
  positive: <SuccessIcon />,
  caution: <AlertIcon />,
  danger: <AlertIcon />,
};

const ToastContext = createContext<ToastApi | null>(null);

function toTone(type: string | undefined): ToastTone {
  return type === 'positive' || type === 'caution' || type === 'danger' ? type : 'neutral';
}

/** Hands callers a stable API, so components that show toasts do not re-render when the stack changes. */
function ToastBridge({children}: {children: ReactNode}) {
  const {add, close} = BaseToast.useToastManager();
  const api = useMemo<ToastApi>(() => ({
    toast: ({title, description, tone = 'neutral', action, duration}) => add({
      title,
      description,
      type: tone,
      ...(duration !== undefined && {timeout: duration}),
      ...(action && {actionProps: {children: action.label, onClick: action.onClick}}),
    }),
    dismiss: id => close(id),
  }), [add, close]);
  return <ToastContext.Provider value={api}>{children}</ToastContext.Provider>;
}

function ToastStack() {
  const {toasts, close} = BaseToast.useToastManager();
  return (
    <>
      {toasts.map(toast => (
        <BaseToast.Root key={toast.id} toast={toast} className={styles.toast} swipeDirection={['right', 'down']}>
          <BaseToast.Content className={styles.content}>
            <div className={styles.message}>
              <span className={styles.icon} aria-hidden="true">{TONE_ICON[toTone(toast.type)]}</span>
              <div className={styles.text}>
                <BaseToast.Title className={styles.title} />
                <BaseToast.Description className={styles.description} />
              </div>
            </div>
            {toast.actionProps ? <BaseToast.Action render={<Button variant="ghost" size="sm" />} onClick={() => close(toast.id)} /> : null}
            <BaseToast.Close render={<Button variant="ghost" size="sm" icon={<CloseIcon />} aria-label="Dismiss" />} />
          </BaseToast.Content>
        </BaseToast.Root>
      ))}
    </>
  );
}

/** Mount once near the root. Renders the toast stack and provides `useToast()` to everything inside. */
export function ToastProvider({children}: {children: ReactNode}) {
  return (
    <BaseToast.Provider limit={VISIBLE_LIMIT}>
      <ToastBridge>{children}</ToastBridge>
      <BaseToast.Portal>
        <BaseToast.Viewport className={styles.viewport}>
          <ToastStack />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

/** `toast()` shows a brief, polite confirmation or warning; `dismiss()` closes one or all. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>.');
  return api;
}
