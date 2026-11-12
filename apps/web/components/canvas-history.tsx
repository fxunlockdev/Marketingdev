"use client";
import {useCallback,useRef,useState} from 'react';
import type {Design} from './creative-editor';

const LIMIT=100,COALESCE_MS=600,DRAFT_PREFIX='desvio:canvas-draft:';
type History={past:Design[];future:Design[]};
export type CanvasHistory={edit:(next:Design)=>void;reset:(design:Design)=>void;undo:()=>void;redo:()=>void;canUndo:boolean;canRedo:boolean};

/** Undo and redo for canvas edits. Rapid changes to the same design (typing, dragging) are one step. */
export function useCanvasHistory(design:Design|undefined,setDesign:(design:Design)=>void):CanvasHistory{
 const stacks=useRef<History>({past:[],future:[]}),current=useRef(design),last=useRef(0);
 const [,setTick]=useState(0);
 current.current=design;
 const commit=useCallback((next:History,shown?:Design)=>{stacks.current=next;if(shown){current.current=shown;setDesign(shown);}setTick(n=>n+1);},[setDesign]);
 const edit=useCallback((next:Design)=>{
  const previous=current.current,now=Date.now(),merge=now-last.current<COALESCE_MS,h=stacks.current;
  last.current=now;
  commit(previous&&!merge?{past:[...h.past,previous].slice(-LIMIT),future:[]}:{past:h.past,future:[]},next);
 },[commit]);
 const reset=useCallback((next:Design)=>{last.current=0;commit({past:[],future:[]},next);},[commit]);
 const undo=useCallback(()=>{const h=stacks.current,previous=h.past.at(-1),now=current.current;if(!previous||!now)return;last.current=0;commit({past:h.past.slice(0,-1),future:[now,...h.future]},previous);},[commit]);
 const redo=useCallback(()=>{const h=stacks.current,next=h.future[0],now=current.current;if(!next||!now)return;last.current=0;commit({past:[...h.past,now],future:h.future.slice(1)},next);},[commit]);
 return {edit,reset,undo,redo,canUndo:stacks.current.past.length>0,canRedo:stacks.current.future.length>0};
}

type Draft={parent:string;design:Design;caption:string;saved_at:string};
/** Browser storage can be missing or full; drafts are a convenience, never the record. */
export function readCanvasDraft(projectId:string,parent:string):{design:Design;caption:string}|null{
 try{
  const raw=localStorage.getItem(DRAFT_PREFIX+projectId);if(!raw)return null;
  const draft=JSON.parse(raw) as Partial<Draft>;
  if(draft.parent!==parent||!draft.design||typeof draft.caption!=='string'||!Array.isArray(draft.design.layers))return null;
  return {design:draft.design,caption:draft.caption};
 }catch{return null;}
}
export function writeCanvasDraft(projectId:string,parent:string,design:Design,caption:string):void{
 try{localStorage.setItem(DRAFT_PREFIX+projectId,JSON.stringify({parent,design,caption,saved_at:new Date().toISOString()} satisfies Draft));}catch{/* storage unavailable: the edit stays in memory */}
}
export function clearCanvasDraft(projectId:string):void{
 try{localStorage.removeItem(DRAFT_PREFIX+projectId);}catch{/* storage unavailable */}
}
