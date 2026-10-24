import yauzl from 'yauzl';
export function readZip(bytes){return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
 if(error)return reject(error);const entries=[];zip.on('error',reject);zip.on('end',()=>resolve(entries));
 zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{entries.push({name:entry.fileName,bytes:Buffer.concat(chunks),crc:entry.crc32});zip.readEntry();});}));zip.readEntry();
}));}
