"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Combobox} from '@base-ui/react/combobox';
import './desvio-select.css';
import './time-zone-select.css';

const common=['UTC','Asia/Kuala_Lumpur','Asia/Kolkata','America/New_York','Europe/London','Asia/Singapore'];
const cityAliases:Record<string,string>={Mumbai:'Asia/Kolkata',Delhi:'Asia/Kolkata','New Delhi':'Asia/Kolkata',Bengaluru:'Asia/Kolkata',Bangalore:'Asia/Kolkata',Chennai:'Asia/Kolkata',Hyderabad:'Asia/Kolkata',Pune:'Asia/Kolkata',Ahmedabad:'Asia/Kolkata',Kolkata:'Asia/Kolkata',Calcutta:'Asia/Kolkata','Abu Dhabi':'Asia/Dubai',Dubai:'Asia/Dubai',Melbourne:'Australia/Melbourne',Sydney:'Australia/Sydney','San Francisco':'America/Los_Angeles',Seattle:'America/Los_Angeles',Boston:'America/New_York',Miami:'America/New_York',Washington:'America/New_York',Ottawa:'America/Toronto',Manchester:'Europe/London',Birmingham:'Europe/London','Kuala Lumpur':'Asia/Kuala_Lumpur'};
const cityName=(zone:string)=>zone==='UTC'?'UTC':zone.split('/').slice(1).join(' / ').replaceAll('_',' ');
const validZone=(zone:string)=>{try{if(!zone)return false;new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}};

export function TimeZoneSelect({id,value,onChange,disabled}:{id:string;value:string;onChange:(value:string)=>void;disabled:boolean}){
 const [zones,setZones]=useState(common),host=useRef<HTMLDivElement>(null),[container,setContainer]=useState<HTMLElement|null>(null);
 useLayoutEffect(()=>setContainer(host.current?.closest('dialog')??null),[]);
 useEffect(()=>{const intl=Intl as typeof Intl & {supportedValuesOf?:(key:string)=>string[]};setZones([...new Set([...common,...(intl.supportedValuesOf?.('timeZone')??[])])].sort());},[]);
 const options=[...new Set([...zones,value].filter(Boolean))].map(zone=>({value:zone,label:`${cityName(zone)} · ${zone.replaceAll('_',' ')}`,keywords:Object.entries(cityAliases).filter(([,v])=>v===zone).map(([city])=>city).join(' ')}));
 const selected=options.find(o=>o.value===value)??null;
 return <div className="ds-select ds-time-zone" ref={host}>
  <Combobox.Root items={options} value={selected} disabled={disabled} onValueChange={option=>{if(option)onChange(option.value);}} isItemEqualToValue={(a,b)=>a.value===b.value} filter={(item,query)=>`${item.label} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase().replaceAll('_',' '))}>
   <Combobox.Trigger id={id} className="ds-select-trigger" aria-describedby={`${id}-selected`}><span className="ds-select-value">{selected?cityName(selected.value):'Choose a time zone'}</span><Combobox.Icon className="ds-select-chevron"><span aria-hidden="true">⌄</span></Combobox.Icon></Combobox.Trigger>
   <Combobox.Portal container={container??undefined}><Combobox.Positioner className="ds-select-positioner" sideOffset={6} collisionBoundary={container??undefined}><Combobox.Popup className="ds-select-popup ds-search-popup" onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>
    <div className="ds-select-search"><Combobox.Input aria-label="Search cities or time zones" placeholder="Search a city or time zone…"/></div>
    <Combobox.Empty className="ds-select-empty">No matching city. Try a nearby major city.</Combobox.Empty>
    <Combobox.List className="ds-select-list">{(option:{value:string;label:string})=><Combobox.Item key={option.value} value={option} className="ds-select-option"><span className="ds-select-option-label">{option.label}</span><Combobox.ItemIndicator className="ds-select-tick">✓</Combobox.ItemIndicator></Combobox.Item>}</Combobox.List>
   </Combobox.Popup></Combobox.Positioner></Combobox.Portal>
  </Combobox.Root>
  <p id={`${id}-selected`} className="time-zone-selection">{validZone(value)?value.replaceAll('_',' '):'Choose a city to set your time zone.'}</p>
 </div>;
}
