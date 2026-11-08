'use client';

import {Children, Fragment, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes} from 'react';
import {Select} from '@base-ui/react/select';
import './desvio-select.css';

export type Choice = {value:string; label:string; disabled?:boolean};
function text(node:ReactNode):string {
 return Children.toArray(node).map(child=>isValidElement<{children?:ReactNode}>(child)?text(child.props.children):String(child)).join('');
}
function choices(children:ReactNode, disabled=false):Choice[] {
 return Children.toArray(children).flatMap(child=>{
  if(!isValidElement<{children?:ReactNode;value?:string|number;disabled?:boolean}>(child))return [];
  if(child.type===Fragment||child.type==='optgroup')return choices(child.props.children,disabled||!!child.props.disabled);
  if(child.type!=='option')return [];
  const label=text(child.props.children);
  return [{value:String(child.props.value??label),label,disabled:disabled||child.props.disabled}];
 });
}
function Chevron(){return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>;}
function Check(){return <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>;}

/** One implementation for the app's single and multiple choice fields.
 * Base UI owns keyboard navigation, typeahead, focus and collision handling.
 * The native select preserves existing form validation, payloads and change handlers.
 */
export function DesvioSelect({children, id:providedId, className='', style, value, defaultValue, onChange, disabled, multiple=false, placeholder='Select an option', ...props}:SelectHTMLAttributes<HTMLSelectElement>&{placeholder?:string}){
 const generated=useId(),id=providedId??generated,native=useRef<HTMLSelectElement>(null),trigger=useRef<HTMLButtonElement>(null),host=useRef<HTMLSpanElement>(null);
 const options=choices(children),[uncontrolled,setUncontrolled]=useState(defaultValue??(multiple?[]:options.find(o=>!o.disabled)?.value??''));
 const [container,setContainer]=useState<HTMLElement|null>(null),[inheritedDisabled,setInheritedDisabled]=useState(false),[open,setOpen]=useState(false),[invalid,setInvalid]=useState(false);
 const raw=value??uncontrolled,selected=multiple?(Array.isArray(raw)?raw.map(String):[]):String(raw),blocked=!!disabled||inheritedDisabled;
 useLayoutEffect(()=>{
  setContainer(host.current?.closest('dialog')??null);
  const fieldsets:HTMLFieldSetElement[]=[];let parent=host.current?.parentElement;
  while(parent){if(parent instanceof HTMLFieldSetElement)fieldsets.push(parent);parent=parent.parentElement;}
  const sync=()=>setInheritedDisabled(native.current?.matches(':disabled')??false);
  sync();const observer=new MutationObserver(sync);fieldsets.forEach(f=>observer.observe(f,{attributes:true,attributeFilter:['disabled']}));
  const form=native.current?.form;const reset=()=>{setUncontrolled(defaultValue??(multiple?[]:options.find(o=>!o.disabled)?.value??''));setInvalid(false);setOpen(false);};form?.addEventListener('reset',reset);
  return()=>{observer.disconnect();form?.removeEventListener('reset',reset);};
 },[disabled,defaultValue,multiple]);
 useLayoutEffect(()=>{if(blocked)setOpen(false);},[blocked]);
 function choose(next:string|string[]|null){
  if(blocked||!native.current)return;
  const values=Array.isArray(next)?next:[next??''];
  for(const option of native.current.options)option.selected=values.includes(option.value);
  native.current.dispatchEvent(new Event('change',{bubbles:true}));
 }
 const display=multiple?(selected.length?`${selected.length} selected`:placeholder):(options.find(o=>o.value===selected)?.label??placeholder);
 return <span ref={host} className={`ds-select ${className}`} style={style} data-multiple={multiple||undefined}>

  <Select.Root<string,boolean> value={selected} multiple={multiple} disabled={blocked} open={open} onOpenChange={setOpen} onValueChange={choose} items={options} modal={false}>
   <Select.Trigger id={id} ref={trigger} className="ds-select-trigger" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby']} aria-describedby={[props['aria-describedby'],invalid?`${id}-error`:null].filter(Boolean).join(' ')||undefined} aria-invalid={invalid||props['aria-invalid']} aria-required={props.required||undefined} title={display}>
    <span className="ds-select-value">{display}</span><Select.Icon className="ds-select-chevron"><Chevron/></Select.Icon>
   </Select.Trigger>
   <Select.Portal container={container??undefined}>
    <Select.Positioner className="ds-select-positioner" sideOffset={6} align="start" alignItemWithTrigger={false} collisionBoundary={container??undefined}>
     <Select.Popup className="ds-select-popup" data-multiple={multiple||undefined} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>
      <Select.List className="ds-select-list" aria-label={props['aria-label']}>
       {options.map(option=><Select.Item key={option.value} value={option.value} disabled={option.disabled} className="ds-select-option">
        {multiple&&<span className="ds-select-checkbox" aria-hidden="true"><Select.ItemIndicator keepMounted><Check/></Select.ItemIndicator></span>}
        <Select.ItemText className="ds-select-option-label">{option.label}</Select.ItemText>
        {!multiple&&<Select.ItemIndicator className="ds-select-tick"><Check/></Select.ItemIndicator>}
       </Select.Item>)}
       {!options.length&&<span className="ds-select-empty">No options available</span>}
      </Select.List>
     </Select.Popup>
    </Select.Positioner>
   </Select.Portal>
  </Select.Root>
  <select {...props} id={`${id}-native`} ref={native} tabIndex={-1} aria-hidden="true" aria-label={undefined} aria-labelledby={undefined} aria-describedby={undefined} className="ds-select-native" disabled={disabled} multiple={multiple} value={selected} onChange={event=>{setUncontrolled(multiple?Array.from(event.target.selectedOptions,o=>o.value):event.target.value);setInvalid(false);onChange?.(event);}} onInvalid={event=>{event.preventDefault();setInvalid(true);trigger.current?.focus();props.onInvalid?.(event);}}>{children}</select>
  {invalid&&<span id={`${id}-error`} role="alert" className="ds-select-error">Choose {multiple?'at least one option':'an option'} to continue.</span>}
 </span>;
}

export function DesvioMultiSelect({label,id,options,value,onChange,disabled,placeholder='Select options'}:{label:string;id?:string;options:Choice[];value:string[];onChange:(values:string[])=>void;disabled?:boolean;placeholder?:string}){
 const generated=useId();const fieldId=id??generated;
 return <div className="ds-multi-field"><label htmlFor={fieldId}>{label}</label><DesvioSelect id={fieldId} aria-label={label} multiple value={value} disabled={disabled} placeholder={placeholder} onChange={event=>onChange(Array.from(event.target.selectedOptions,o=>o.value))}>{options.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</DesvioSelect></div>;
}
