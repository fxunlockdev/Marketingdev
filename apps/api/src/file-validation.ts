import {createConnection} from 'node:net';
import sharp from 'sharp';
import yauzl from 'yauzl';
import {InvalidAsset} from './object-store.js';
import type {ScannerConfig} from './config.js';

export const TYPES:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','application/pdf':'.pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx'};
export async function validateFormat(bytes:Buffer,type:string) {
  if(type.startsWith('image/')) {
    try {
      const image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'warning'}),meta=await image.metadata();
      if(meta.format!==({'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'} as Record<string,string>)[type]
        || (meta.pages??1)!==1 || !meta.width || !meta.height || meta.width>12000 || meta.height>12000) throw new Error();
      await image.stats();return;
    }catch{throw new InvalidAsset('INVALID_IMAGE');}
  }
  if(type==='application/pdf') {
    if(!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-') || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) throw new InvalidAsset('INVALID_PDF');
    return; // Document content extraction/sandboxing is a separate later stage.
  }
  if(!type.endsWith('presentationml.presentation')) throw new InvalidAsset('UNSUPPORTED_FORMAT');
  await new Promise<void>((resolve,reject)=>{
    yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
      if(error || !zip){reject(new InvalidAsset('INVALID_PRESENTATION'));return;}
      let count=0,total=0;const names=new Set<string>();let stopped=false;
      const fail=()=>{if(!stopped){stopped=true;zip.close();reject(new InvalidAsset('UNSAFE_PRESENTATION'));}};
      zip.on('error',fail);
      zip.on('entry',entry=>{
        count++;total+=entry.uncompressedSize;
        const parts=entry.fileName.split('/');
        if(count>1000 || total>100*1024*1024 || entry.uncompressedSize>20*1024*1024 || entry.uncompressedSize>Math.max(entry.compressedSize,1)*200
          || parts.includes('..') || entry.fileName.startsWith('/') || names.has(entry.fileName)
          || (entry.generalPurposeBitFlag&1) || ((entry.externalFileAttributes>>>16)&0xf000)===0xa000
          || /vbaproject|\.exe$|\.zip$/i.test(entry.fileName)){fail();return;}
        names.add(entry.fileName);zip.readEntry();
      });
      zip.on('end',()=>{if(stopped)return;if(!names.has('[Content_Types].xml')||!names.has('ppt/presentation.xml')){reject(new InvalidAsset('INVALID_PRESENTATION'));return;}resolve();});
      zip.readEntry();
    });
  });
}

export class MalwareScanner {
  constructor(readonly config:ScannerConfig) {}
  private command(command:string,body?:Buffer):Promise<string> {
    return new Promise((resolve,reject)=>{
      const socket=createConnection({host:this.config.host,port:this.config.port});let output=Buffer.alloc(0),done=false;
      const finish=(error?:Error)=>{if(done)return;done=true;socket.destroy();if(error)reject(error);else resolve(output.toString('utf8').replace(/\0.*$/s,'').trim());};
      socket.setTimeout(20000,()=>finish(new Error('SCANNER_TIMEOUT')));
      socket.on('error',()=>finish(new Error('SCANNER_UNAVAILABLE')));
      socket.on('connect',()=>{
        socket.write(Buffer.from(`z${command}\0`));
        if(body){for(let i=0;i<body.length;i+=65536){const chunk=body.subarray(i,i+65536),size=Buffer.alloc(4);size.writeUInt32BE(chunk.length);socket.write(size);socket.write(chunk);}socket.write(Buffer.alloc(4));}
      });
      socket.on('data',chunk=>{output=Buffer.concat([output,Buffer.from(chunk)]);if(output.length>4096){finish(new Error('SCANNER_PROTOCOL_ERROR'));return;}if(output.includes(0))finish();});
      socket.on('end',()=>finish(new Error('SCANNER_PROTOCOL_ERROR')));
    });
  }
  async scan(bytes:Buffer) {
    const version=await this.command('VERSION');
    const parts=version.split('/'),date=Date.parse(parts.slice(2).join('/')),age=Date.now()-date;
    if(!version.startsWith('ClamAV ') || !Number.isFinite(age) || age< -3600000 || age>7*24*3600000) throw new Error('SCANNER_SIGNATURES_STALE');
    const result=await this.command('INSTREAM',bytes);
    if(result.endsWith(' FOUND')) throw new InvalidAsset('MALWARE_DETECTED');
    if(result!=='stream: OK') throw new Error('SCANNER_UNAVAILABLE');
    return version;
  }
}
