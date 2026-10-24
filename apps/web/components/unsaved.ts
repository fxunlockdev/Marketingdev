"use client";
import { useEffect } from "react";
const editors=new Set<symbol>();
export function confirmNavigation(){return !editors.size||window.confirm('Leave this page? Your unsaved changes will be lost.');}
// Native navigation warning; never persists passwords, private files or grants in web storage.
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const editor=Symbol();editors.add(editor);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {editors.delete(editor);window.removeEventListener("beforeunload", warn);};
  }, [dirty]);
}

// Track only navigation positions, never form values. App Router retains its own
// history state. A canceled traversal is restored before its popstate listener
// can unmount the editor; no extra history entries are inserted.
export function useHistoryEditGuard() {
  useEffect(() => {
    const key = '__desvioNavigation';
    const saved = history.state?.[key];
    const seed = typeof saved?.seed === 'string' ? saved.seed : crypto.randomUUID();
    let position = Number.isSafeInteger(saved?.position) ? saved.position : 0;
    let restoring = false;
    const push = history.pushState, replace = history.replaceState;
    const state = (data: any, index: number) => ({ ...data, [key]: { seed, position: index } });
    const pushTracked: History['pushState'] = function(data, unused, url) {
      const next = position + 1;
      push.call(history, state(data, next), unused, url);
      position = next;
    };
    const replaceTracked: History['replaceState'] = function(data, unused, url) {
      replace.call(history, state(data, position), unused, url);
    };
    replace.call(history, state(history.state, position), '');
    history.pushState = pushTracked;
    history.replaceState = replaceTracked;
    const traverse = (event: PopStateEvent) => {
      const target = event.state?.[key];
      if (target?.seed !== seed || !Number.isSafeInteger(target.position)) return;
      if (restoring) {
        event.stopImmediatePropagation();
        if (target.position === position) restoring = false;
        else history.go(position - target.position);
        return;
      }
      if (target.position !== position && !confirmNavigation()) {
        event.stopImmediatePropagation();
        restoring = true;
        history.go(position - target.position);
        return;
      }
      position = target.position;
    };
    window.addEventListener('popstate', traverse, true);
    return () => {
      window.removeEventListener('popstate', traverse, true);
      if (history.pushState === pushTracked) history.pushState = push;
      if (history.replaceState === replaceTracked) history.replaceState = replace;
    };
  }, []);
}
