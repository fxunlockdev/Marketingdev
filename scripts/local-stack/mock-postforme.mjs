// Development-only mock of the Post for Me endpoints Desvio calls. Deterministic: no randomness, no network.
// The API and worker reach it only through POSTFORME_BASE_URL, which the product accepts only when
// APP_MODE is development or test and the URL is a loopback origin (apps/api/src/postforme-client.ts).
//
// Lifecycle: an account connects through a local consent page; a post is "scheduled" until its time,
// then "processed" with a successful result (a caption containing "[mock-fail]" fails instead, with a reason).
// Metrics are derived from the post id, its media count and its age, so the same post always reports the same totals.
// Dev controls: POST /__mock/publish-due {"all":true} publishes scheduled posts now; POST /__mock/age {"hours":96}
// backdates published posts (to simulate settled results); GET /__mock/state.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';

const PLATFORMS=['instagram','facebook','linkedin','tiktok','youtube','threads','x','pinterest','bluesky'];
const hashOf=value=>createHash('sha256').update(String(value)).digest('hex');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** @param {{origin:string,appOrigin?:string,now?:()=>number}} options */
export function createMockPostforme({origin,appOrigin='http://127.0.0.1:3000',now=()=>Date.now()}){
 const state={accounts:new Map(),posts:new Map(),uploads:new Map(),pending:new Map(),counter:0,requests:0};
 const next=prefix=>`${prefix}_${String(++state.counter).padStart(6,'0')}`;
 const platformUrl=post=>`https://social.example.test/${post.platform}/p/${post.id}`;
 /** Scheduled posts whose time has come are processed. */
 function settle(){
  for(const post of state.posts.values())if(post.status==='scheduled'&&Date.parse(post.scheduled_at)<=now())publish(post,now());
 }
 function publish(post,at){
  const failed=post.fails===true||post.caption.includes('[mock-fail]');
  Object.assign(post,{status:'processed',posted_at:new Date(at).toISOString(),result:failed?{success:false,error:{message:'Mock: the network rejected this media (aspect ratio not supported)'}}:{success:true,platform_data:{id:'pp_'+post.id,url:platformUrl(post)}}});
 }
 function metrics(post){
  const h=parseInt(hashOf(post.id).slice(0,8),16),hours=Math.max(0,(now()-Date.parse(post.posted_at))/3600000),grow=Math.min(1,0.25+hours/96),slides=post.media.length;
  const base={likes:20+h%60+(slides>1?40:0),views:300+h%900+(slides>1?400:0),comments:h%15,shares:h%9,saves:h%12+(slides>1?25:0)};
  return Object.fromEntries(Object.entries(base).map(([k,v])=>[k,Math.round(v*grow)]));
 }
 const view=post=>({id:post.id,external_id:post.external_id,caption:post.caption,scheduled_at:post.scheduled_at,status:post.status,social_accounts:[{id:post.account_id}],media:post.media,platform_configurations:post.platform_configurations??null});
 function createPost(body,existing){
  const accounts=Array.isArray(body?.social_accounts)?body.social_accounts:[];
  if(accounts.length!==1||!state.accounts.has(accounts[0])||state.accounts.get(accounts[0]).status!=='connected')return json({message:'Unknown social account'},400);
  if(typeof body.caption!=='string'||!Number.isFinite(Date.parse(body.scheduled_at)))return json({message:'Invalid post'},400);
  const media=Array.isArray(body.media)?body.media:[];
  for(const m of media){const key=String(m?.url??'').replace(`${origin}/media/`,'');if(!state.uploads.has(key))return json({message:'Media was not uploaded'},400);}
  const account=state.accounts.get(accounts[0]);
  const post={...(existing??{id:next('sp'),status:'scheduled'}),external_id:body.external_id??existing?.external_id??null,caption:body.caption,scheduled_at:new Date(Date.parse(body.scheduled_at)).toISOString(),account_id:account.id,platform:account.platform,media:media.map(m=>({url:m.url,...(typeof m.alt_text==='string'?{alt_text:m.alt_text}:{})})),platform_configurations:body.platform_configurations??existing?.platform_configurations??null};
  state.posts.set(post.id,post);return json(view(post));
 }
 async function readBody(request){const text=await request.text();if(!text)return undefined;try{return JSON.parse(text);}catch{return null;}}
 function consentPage(attempt){
  return new Response(`<!doctype html><meta charset="utf-8"><title>Post for Me (local mock)</title><body style="font:16px system-ui;max-width:520px;margin:64px auto;padding:0 16px"><p><strong>Local mock of Post for Me.</strong> Nothing leaves this computer.</p><h1>Connect ${escapeHtml(attempt.platform)}</h1><p>Desvio asks to publish posts and read their results for a mock ${escapeHtml(attempt.platform)} profile.</p><form method="post" action="${origin}/oauth/approve"><input type="hidden" name="attempt" value="${escapeHtml(attempt.id)}"><button style="font:inherit;padding:12px 20px">Allow and return to Desvio</button></form></body>`,{headers:{'content-type':'text/html; charset=utf-8'}});
 }
 async function handle(input,init={}){
  const request=input instanceof Request?input:new Request(input,init);
  const url=new URL(request.url),method=request.method,path=url.pathname,q=url.searchParams;state.requests++;settle();
  if(path.startsWith('/v1/')&&!request.headers.get('authorization')?.startsWith('Bearer '))return json({message:'Unauthorized'},401);
  if(method==='POST'&&path==='/v1/social-accounts/auth-url'){
   const body=await readBody(request);if(!PLATFORMS.includes(body?.platform)||typeof body?.external_id!=='string')return json({message:'Invalid request'},400);
   const attempt={id:next('att'),platform:body.platform,external_id:body.external_id};state.pending.set(attempt.id,attempt);
   return json({url:`${origin}/oauth/authorize?attempt=${attempt.id}`});
  }
  if(method==='GET'&&path==='/oauth/authorize'){const attempt=state.pending.get(q.get('attempt')??'');return attempt?consentPage(attempt):new Response('Unknown attempt',{status:404});}
  if(method==='POST'&&path==='/oauth/approve'){
   const attempt=state.pending.get(new URLSearchParams(await request.text()).get('attempt')??'');if(!attempt)return new Response('Unknown attempt',{status:404});
   state.pending.delete(attempt.id);connect(attempt.platform,attempt.external_id);
   return new Response(null,{status:303,headers:{location:`${appOrigin}/connections/postforme/return`}});
  }
  if(method==='GET'&&path==='/v1/social-accounts'){
   const external=q.get('external_id'),offset=Number(q.get('offset')??0),limit=Number(q.get('limit')??100);
   return json({data:[...state.accounts.values()].filter(a=>a.external_id===external).slice(offset,offset+limit)});
  }
  let m=/^\/v1\/social-accounts\/([^/]+)\/disconnect$/.exec(path);
  if(method==='POST'&&m){const a=state.accounts.get(decodeURIComponent(m[1]));if(!a)return json({message:'Not found'},404);a.status='disconnected';return json(a);}
  if(method==='POST'&&path==='/v1/media/create-upload-url'){const key=next('media');return json({upload_url:`${origin}/upload/${key}`,media_url:`${origin}/media/${key}`});}
  m=/^\/upload\/([\w-]+)$/.exec(path);
  if(method==='PUT'&&m){const bytes=Buffer.from(await request.arrayBuffer());if(!bytes.length)return new Response('Empty',{status:400});state.uploads.set(m[1],{bytes:bytes.length,sha256:hashOf(bytes),type:request.headers.get('content-type')});return new Response(null,{status:200});}
  if(method==='POST'&&path==='/v1/social-posts')return createPost(await readBody(request));
  if(method==='GET'&&path==='/v1/social-posts'){const external=q.get('external_id');return json({data:[...state.posts.values()].filter(p=>!external||p.external_id===external).map(view)});}
  m=/^\/v1\/social-posts\/([^/]+)$/.exec(path);
  if(m){
   const post=state.posts.get(decodeURIComponent(m[1]));if(!post)return json({message:'Not found'},404);
   if(method==='GET')return json(view(post));
   if(post.status!=='scheduled')return json({message:'Only a scheduled post can be changed'},409);
   if(method==='PUT')return createPost(await readBody(request),post);
   if(method==='DELETE'){state.posts.delete(post.id);return json({success:true});}
  }
  if(method==='GET'&&path==='/v1/social-post-results'){
   const post=state.posts.get(q.get('post_id')??''),account=q.get('social_account_id');
   return json({data:post?.result&&(!account||post.account_id===account)?[{id:'res_'+post.id,post_id:post.id,social_account_id:post.account_id,...post.result}]:[]});
  }
  m=/^\/v1\/social-account-feeds\/([^/]+)$/.exec(path);
  if(method==='GET'&&m){
   const account=decodeURIComponent(m[1]);if(!state.accounts.has(account))return json({message:'Not found'},404);
   const posts=[...state.posts.values()].filter(p=>p.account_id===account&&p.result?.success).sort((a,b)=>b.posted_at.localeCompare(a.posted_at)).slice(0,Number(q.get('limit')??50));
   return json({data:posts.map(p=>({social_account_id:account,platform_post_id:'pp_'+p.id,platform:p.platform,caption:p.caption,posted_at:p.posted_at,platform_url:platformUrl(p),metrics:metrics(p)}))});
  }
  if(method==='POST'&&path==='/__mock/publish-due'){const body=await readBody(request);let n=0;for(const p of state.posts.values())if(p.status==='scheduled'&&(body?.all===true||Date.parse(p.scheduled_at)<=now())){publish(p,now());n++;}return json({published:n});}
  if(method==='POST'&&path==='/__mock/age'){const hours=Number((await readBody(request))?.hours);if(!Number.isFinite(hours)||hours<0||hours>2000)return json({message:'hours 0..2000'},400);let n=0;for(const p of state.posts.values())if(p.posted_at){p.posted_at=new Date(Date.parse(p.posted_at)-hours*3600000).toISOString();n++;}return json({aged:n});}
  if(method==='GET'&&path==='/__mock/state')return json({accounts:[...state.accounts.values()],posts:[...state.posts.values()].map(p=>({...view(p),posted_at:p.posted_at??null,result:p.result??null})),uploads:state.uploads.size,requests:state.requests});
  return json({message:'Not mocked'},404);
 }
 /** Deterministic account for a binding, as Post for Me creates after consent. */
 function connect(platform,external){
  const id=`spc_mock_${platform}_${hashOf(external).slice(0,10)}`;
  const account={id,platform,username:`Mock ${platform[0].toUpperCase()}${platform.slice(1)} profile`,external_id:external,status:'connected',profile_photo_url:null};
  state.accounts.set(id,account);return account;
 }
 return {origin,state,fetch:handle,connect,publishDue:()=>{for(const p of state.posts.values())if(p.status==='scheduled')publish(p,now());}};
}

/** Serve the mock on 127.0.0.1 for the local stack. */
export function startMockPostforme(port,{appOrigin,log=()=>{}}={}){
 const origin=`http://127.0.0.1:${port}`,mock=createMockPostforme({origin,appOrigin});
 const server=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const c of req)chunks.push(c);
   const body=chunks.length&&!['GET','HEAD'].includes(req.method)?Buffer.concat(chunks):undefined;
   const response=await mock.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,body}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   if(!req.url.startsWith('/upload/'))log(`post-for-me mock ${req.method} ${req.url.split('?')[0]} -> ${response.status}`);
  }catch(error){res.writeHead(500);res.end();log(`post-for-me mock error: ${error.message}`);}
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve({mock,server,close:()=>new Promise(r=>server.close(r))}));});
}
