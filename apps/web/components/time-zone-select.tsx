"use client";
import {useEffect,useState} from 'react';
const common=['UTC','Asia/Kuala_Lumpur','Asia/Kolkata','Asia/Calcutta','America/New_York','Europe/London'];
export function TimeZoneSelect({id,value,onChange,disabled}:{id:string;value:string;onChange:(value:string)=>void;disabled:boolean}){
 const [zones,setZones]=useState(common);
 useEffect(()=>{const intl=Intl as typeof Intl & {supportedValuesOf?:(key:string)=>string[]};setZones([...new Set([...common,...(intl.supportedValuesOf?.('timeZone')??[])])].sort());},[]);
 const valid=(()=>{try{if(!value)return false;new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}})();
 return <select id={id} value={valid?value:''} disabled={disabled} onChange={e=>onChange(e.target.value)} required><option value="" disabled>Select your time zone</option>{[...new Set([...zones,...(valid?[value]:[])])].sort().map(zone=><option key={zone} value={zone}>{zone.replaceAll('_',' ').replaceAll('/',' / ')}</option>)}</select>;
}
