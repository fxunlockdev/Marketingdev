import {crc32} from 'node:zlib';

export type DownloadEntry={name:string;bytes:number;read:()=>Promise<Buffer>};
// STORE avoids recompressing PNGs. Only one bounded entry is loaded at a time.
export function zipDownload(entries:DownloadEntry[]){
 if(!entries.length||entries.length>12||new Set(entries.map(e=>e.name)).size!==entries.length||entries.some(e=>! /^[a-z0-9-]+\.(png|txt|json)$/.test(e.name)||!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>20*1024*1024))throw new Error('Invalid download entries');
 const length=22+entries.reduce((n,e)=>n+76+2*Buffer.byteLength(e.name)+e.bytes,0);
 async function* stream(){
  let offset=0;const central:Buffer[]=[];
  for(const entry of entries){
   const data=await entry.read();if(data.length!==entry.bytes)throw new Error('Download integrity check failed');
   const name=Buffer.from(entry.name),crc=crc32(data),header=Buffer.alloc(30);
   header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x21,12);
   header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
   const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x21,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
   central.push(record,name);offset+=header.length+name.length+data.length;
   yield header;yield name;yield data;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
  for(const record of central)yield record;yield end;
 }
 return {length,stream};
}
