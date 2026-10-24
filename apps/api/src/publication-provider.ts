// Eligibility is checked against metadata saved with the exact canonical render.
// Legacy renders without that evidence must be rendered and approved again.
export function publicationChannel(provider:string){return provider==='linkedin'?'linkedin':provider==='instagram-standalone'?'instagram':null;}
export function validReel(row:any){
 const m=row?.manifest?.metadata,bytes=Number(row?.bytes);
 return !!m&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)
  &&row.manifest.video_sha256===row.sha256&&m.codec==='h264'&&typeof m.audio==='boolean'
  &&Number.isSafeInteger(m.width)&&m.width>=64&&m.width<=1920&&m.width%2===0
  &&Number.isSafeInteger(m.height)&&m.height>=64&&m.height<=1920&&m.height%2===0
  &&Math.min(m.width,m.height)<=1080
  &&Number.isSafeInteger(m.duration_ms)&&m.duration_ms>=3000&&m.duration_ms<=15000
  &&Number.isSafeInteger(bytes)&&bytes>=24&&bytes<=64*1024*1024
  &&bytes*8000/m.duration_ms<=25000000;
}
