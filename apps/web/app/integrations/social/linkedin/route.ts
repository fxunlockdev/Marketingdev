import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// Compare the public Host with configured origin: Next normalizes loopback URLs
// and a reverse proxy can use an internal server origin. Never trust forwarded
// host headers or derive a redirect destination from the incoming request.
// The code is handled only on the server. No HTML, browser storage, script
// payload, log or redirect contains it. State/session verification stays in API.
export async function GET(request:NextRequest){
 let origin:URL,apiBase:URL;
 try{origin=new URL(process.env.APP_ORIGIN!);apiBase=new URL(process.env.API_ORIGIN!);if(origin.origin!==process.env.APP_ORIGIN||request.headers.get('host')!==origin.host||origin.username||origin.password||apiBase.username||apiBase.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname))||!['http:','https:'].includes(apiBase.protocol)||apiBase.pathname!=='/'||apiBase.search||apiBase.hash)throw new Error();}catch{return new Response('Connection return is unavailable. Open Desvio and start again.',{status:503,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','content-type':'text/plain'}});}
 const redirect=(path:string)=>{const response=NextResponse.redirect(new URL(path,origin),303);response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');return response;};
 const provider=request.nextUrl.pathname.endsWith('/instagram-standalone')?'instagram-standalone':'linkedin';
 const query=request.nextUrl.searchParams,state=query.get('state')??'',parts=state.split('.'),brand=parts[0],attempt=parts[1];
 const validState=query.getAll('state').length===1&&parts.length===3&&uuid.test(brand)&&uuid.test(attempt)&&/^[A-Za-z0-9_-]{43}$/.test(parts[2]);
 const failure=(reason:string)=>redirect('/integrations/social/result?reason='+reason+(validState?'&business='+brand+'&attempt='+attempt:''));
 const code=query.get('code'),denied=query.has('error');
 if(!validState||denied&&(query.getAll('error').length!==1||query.has('code'))||!denied&&(query.getAll('code').length!==1||!code||code.length>8000||/[\x00-\x1f\x7f]/.test(code)))return failure('invalid');
 let response:Response;try{response=await fetch(new URL(`/api/v1/businesses/${brand}/connections/oauth/${attempt}/callback`,apiBase),{method:'POST',headers:{cookie:request.headers.get('cookie')??'',origin:origin.origin,'content-type':'application/json'},body:JSON.stringify({provider,state,...(!denied?{code}:{}),denied}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{return failure('unconfirmed');}
 await response.body?.cancel().catch(()=>{});
 if(!response.ok)return failure(response.status===401?'session':response.status===403||response.status===404?'access':response.status===409?'expired':'unconfirmed');
 return redirect(`/b/${brand}/connections?attempt=${attempt}`);
}
