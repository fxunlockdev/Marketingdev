// Public delivery of files already transferred to Postiz for approved publication.
// Canonical/private Desvio assets never pass through this endpoint.
const limit=64*1024*1024;
const failure=status=>new Response(null,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function publishedMedia(request,path,env=process.env,transport=fetch){
 if(!['GET','HEAD'].includes(request.method))return failure(405);
 let base,extension;
 try{
  if(!env.POSTIZ_MEDIA_PROXY_ORIGIN)return failure(404);
  base=new URL(env.POSTIZ_MEDIA_PROXY_ORIGIN);
  const local=env.NODE_ENV==='test'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname);
  if(base.origin!==env.POSTIZ_MEDIA_PROXY_ORIGIN||base.username||base.password||!(base.protocol==='https:'||base.protocol==='http:'&&(base.hostname.endsWith('.railway.internal')||local)))throw Error();
  if(!Array.isArray(path)||path.length!==4||!/^20\d{2}$/.test(path[0])||!/^\d{2}$/.test(path[1])||!/^\d{2}$/.test(path[2])||! /^[a-f0-9]{32,64}\.(png|mp4)$/.test(path[3]))return failure(404);
  const date=new Date(Date.UTC(Number(path[0]),Number(path[1])-1,Number(path[2])));
  if(date.toISOString().slice(0,10)!==path.slice(0,3).join('-'))return failure(404);
  extension=path[3].split('.').at(-1);
 }catch{return failure(503);}
 const range=request.headers.get('range');let requested;
 if(range){
  requested=/^bytes=(\d{1,9})-(\d{0,9})$/.exec(range);
  if(request.method!=='GET'||!requested||Number(requested[1])>=limit||requested[2]&&(Number(requested[2])<Number(requested[1])||Number(requested[2])>=limit))return failure(416);
 }
 let upstream;
 try{
  upstream=await transport(new URL('/uploads/'+path.join('/'),base),{method:request.method,headers:{'accept':extension==='png'?'image/png':'video/mp4','accept-encoding':'identity',...(range?{range}:{})},redirect:'error',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])});
  if(upstream.status===404){await upstream.body?.cancel();return failure(404);}
  const length=upstream.headers.get('content-length'),type=upstream.headers.get('content-type')?.split(';')[0];
  if(![200,206].includes(upstream.status)||!/^\d+$/.test(length??'')||Number(length)<1||Number(length)>limit||type!==(extension==='png'?'image/png':'video/mp4')||!['identity',null].includes(upstream.headers.get('content-encoding')))throw Error();
  const headers=new Headers({'content-type':type,'content-length':length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'content-disposition':'inline; filename="'+path[3]+'"','referrer-policy':'no-referrer'});
  if(upstream.status===206){
   const value=upstream.headers.get('content-range'),match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(value??'');
   if(!requested||!match||Number(match[1])!==Number(requested[1])||Number(match[2])<Number(match[1])||Number(match[2])-Number(match[1])+1!==Number(length)||Number(match[2])>=Number(match[3])||Number(match[3])>limit||requested[2]&&Number(match[2])>Number(requested[2]))throw Error();
   headers.set('content-range',value);
  }
  if(request.method==='HEAD'){await upstream.body?.cancel();return new Response(null,{status:upstream.status,headers});}
  if(!upstream.body)throw Error();
  let bytes=0;
  const body=upstream.body.pipeThrough(new TransformStream({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>Number(length)||bytes>limit)throw Error('MEDIA_LENGTH_INVALID');controller.enqueue(chunk);},flush(){if(bytes!==Number(length))throw Error('MEDIA_LENGTH_INVALID');}}));
  return new Response(body,{status:upstream.status,headers});
 }catch{await upstream?.body?.cancel().catch(()=>{});return failure(502);}
}
