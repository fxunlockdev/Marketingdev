"use client";
import Link from 'next/link';
import type {ComponentProps} from 'react';
import {confirmNavigation} from './unsaved';
/** Same-document navigation retains the workspace shell; browser/new-tab semantics stay native. */
export function AppLink(props:ComponentProps<typeof Link>){return <Link {...props} onNavigate={event=>{if(!confirmNavigation())event.preventDefault();else props.onNavigate?.(event);}}/>;}
