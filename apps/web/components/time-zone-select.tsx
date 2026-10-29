"use client";
import {useEffect,useState} from 'react';
import './time-zone-select.css';

const common=['UTC','Asia/Kuala_Lumpur','Asia/Kolkata','America/New_York','Europe/London','Asia/Singapore'];
const cityAliases:Record<string,string>={Mumbai:'Asia/Kolkata',Delhi:'Asia/Kolkata','New Delhi':'Asia/Kolkata',Bengaluru:'Asia/Kolkata',Bangalore:'Asia/Kolkata',Chennai:'Asia/Kolkata',Hyderabad:'Asia/Kolkata',Pune:'Asia/Kolkata',Ahmedabad:'Asia/Kolkata',Kolkata:'Asia/Kolkata',Calcutta:'Asia/Kolkata','Abu Dhabi':'Asia/Dubai',Dubai:'Asia/Dubai',Melbourne:'Australia/Melbourne',Sydney:'Australia/Sydney','San Francisco':'America/Los_Angeles',Seattle:'America/Los_Angeles',Boston:'America/New_York',Miami:'America/New_York',Washington:'America/New_York',Ottawa:'America/Toronto',Manchester:'Europe/London',Birmingham:'Europe/London','Kuala Lumpur':'Asia/Kuala_Lumpur'};
const cityName=(zone:string)=>zone==='UTC'?'UTC':zone.split('/').slice(1).join(' / ').replaceAll('_',' ');
const validZone=(zone:string)=>{try{if(!zone)return false;new Intl.DateTimeFormat('en',{timeZone:zone});return true;}catch{return false;}};

export function TimeZoneSelect({id,value,onChange,disabled}:{id:string;value:string;onChange:(value:string)=>void;disabled:boolean}){
 const [zones,setZones]=useState(common);
 const [query,setQuery]=useState('');
 const [open,setOpen]=useState(false);
 useEffect(()=>{const intl=Intl as typeof Intl & {supportedValuesOf?:(key:string)=>string[]};setZones([...new Set([...common,...(intl.supportedValuesOf?.('timeZone')??[])])].sort());},[]);
 const normalized=query.trim().toLowerCase().replaceAll('_',' ');
 const options=[...zones.map(zone=>({city:cityName(zone),zone})),...Object.entries(cityAliases).map(([city,zone])=>({city,zone}))];
 const candidates=normalized?options:common.map(zone=>({city:cityName(zone),zone}));
 const matches=candidates.filter((option,index)=>candidates.findIndex(item=>item.city===option.city&&item.zone===option.zone)===index).filter(option=>normalized?`${option.city} ${option.zone.replaceAll('_',' ')}`.toLowerCase().includes(normalized):common.includes(option.zone)).sort((a,b)=>Number(b.city.toLowerCase()===normalized)-Number(a.city.toLowerCase()===normalized)||a.city.localeCompare(b.city)).slice(0,6);
 const choose=(zone:string)=>{onChange(zone);setQuery('');setOpen(false);};
 return <div className="time-zone-search" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <input id={id} type="search" value={query} disabled={disabled} placeholder="Search a city, e.g. Mumbai" autoComplete="off" aria-describedby={`${id}-selected`} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setOpen(true);}} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);if(event.key==='Enter'){event.preventDefault();if(matches.length===1)choose(matches[0].zone);}}}/>
  <p id={`${id}-selected`} className="time-zone-selection">{validZone(value)?<>Selected: <strong>{cityName(value)}</strong> <span>({value.replaceAll('_',' ')})</span></>:'Choose a city to set your time zone.'}</p>
  {open&&!disabled&&<div className="time-zone-results"><p className="time-zone-results-label">{normalized?'Matching cities':'Popular cities'}</p>{matches.length?<ul>{matches.map(option=><li key={`${option.city}-${option.zone}`}><button type="button" onClick={()=>choose(option.zone)}><strong>{option.city}</strong><span>{option.zone.replaceAll('_',' ')}</span></button></li>)}</ul>:<p className="time-zone-no-results">No matching city. Try a nearby major city or a time zone such as Europe/London.</p>}</div>}
 </div>;
}
