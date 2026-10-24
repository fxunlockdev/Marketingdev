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
