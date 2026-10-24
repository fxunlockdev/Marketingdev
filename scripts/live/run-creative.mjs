import {readFile,writeFile,rename,mkdir,rm,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import sharp from 'sharp';
import {creativeAcceptance} from './creative-acceptance.mjs';
const fail=code=>{throw Error(code);};
const exactId=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
export function liveSettings(env){
 if(env.APP_MODE!=='staging'||env.LIVE_SMOKE_ENABLED!=='true'||env.LIVE_SMOKE_ACK!=='I_AUTHORIZE_CAPPED_STAGING_TESTS'||env.LIVE_TEST_SCOPE!=='creative')fail('LIVE_AUTHORIZATION_REQUIRED');
 if(env.LIVE_TEST_ORIGIN!=='https://desvio-dev-web-dev.up.railway.app')fail('LIVE_DEDICATED_DEV_ORIGIN_REQUIRED');
 if(!exactId(env.LIVE_TEST_ORG_IDS)||!exactId(env.LIVE_TEST_BRAND_IDS))fail('LIVE_EXACT_SCOPE_REQUIRED');
 if(!/^\d{1,4}(?:\.\d{1,6})?$/.test(env.PROVIDER_BUDGET_USD??''))fail('LIVE_BUDGET_INVALID');
 const [dollars,fraction='']=env.PROVIDER_BUDGET_USD.split('.'),budgetMicros=Number(BigInt(dollars)*1000000n+BigInt(fraction.padEnd(6,'0')));
 if(budgetMicros<2||budgetMicros>1000000000)fail('LIVE_BUDGET_INVALID');
 const mediaOrigins=(env.LIVE_TEST_MEDIA_ORIGINS??'').split(',').filter(Boolean);
 if(!mediaOrigins.length||mediaOrigins.some(v=>{try{const u=new URL(v);return u.protocol!=='https:'||u.origin!==v||u.username||u.password;}catch{return true;}}))fail('LIVE_MEDIA_ORIGINS_REQUIRED');
 if(!env.LIVE_TEST_CREDENTIALS_FILE||!env.LIVE_TEST_JOURNAL)fail('LIVE_PRIVATE_FILES_REQUIRED');
 return {origin:env.LIVE_TEST_ORIGIN,organizationId:env.LIVE_TEST_ORG_IDS,businessId:env.LIVE_TEST_BRAND_IDS,budgetMicros,mediaOrigins};
}
async function privateJSON(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid())fail('LIVE_PRIVATE_FILE_PERMISSIONS');return JSON.parse(await readFile(path,'utf8'));}
export function customerClient(origin,signal,fetcher=fetch){
 let cookie='';
 const request=async(path,body,key,method)=>{
  if(!path.startsWith('/api/')||path.includes('://')||path.includes('#')||path.includes('\\'))fail('LIVE_API_PATH_DENIED');
  const response=await fetcher(origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...(key?{'idempotency-key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>2000000)fail('LIVE_RESPONSE_LIMIT');parts.push(part);}const raw=Buffer.concat(parts).toString('utf8');
  let data;try{data=JSON.parse(raw);}catch{fail('LIVE_RESPONSE_INVALID');}
  if(path==='/api/auth/sign-in/email'&&response.ok){cookie=response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');if(!cookie||!data.user?.id||data.twoFactorRedirect)fail('LIVE_VERIFIED_TEST_LOGIN_REQUIRED');}
  return {status:response.status,body:data};
 };
 return {request,close:async()=>{if(cookie)await fetcher(origin+'/api/auth/sign-out',{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)}).catch(()=>{});cookie='';}};
}
export async function imageBytes(url,origins,signal,fetcher=fetch){
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash||!origins.includes(u.origin))fail('LIVE_MEDIA_ORIGIN_DENIED');
 const r=await fetcher(u,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='image/png')fail('LIVE_MEDIA_INVALID');
 const parts=[];let size=0;for await(const part of r.body){size+=part.length;if(size>20*1024*1024)fail('LIVE_MEDIA_LIMIT');parts.push(part);}const bytes=Buffer.concat(parts);
 const image=sharp(bytes,{limitInputPixels:24000000});const m=await image.metadata();if(m.format!=='png'||m.width!==1024||m.height!==1024)fail('LIVE_MEDIA_DIMENSIONS_INVALID');await image.raw().toBuffer();return bytes;
}
export async function main(env=process.env){
 let owner,foreign,anonymous,locked=false,state,journal,save;
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 try{
  const config=liveSettings(env),credentials=await privateJSON(env.LIVE_TEST_CREDENTIALS_FILE);
  if(['email','password','foreignEmail','foreignPassword'].some(k=>typeof credentials[k]!=='string'||!credentials[k]))fail('LIVE_TEST_LOGINS_REQUIRED');
  journal=resolve(env.LIVE_TEST_JOURNAL);await mkdir(journal+'.lock',{mode:0o700});locked=true;await writeFile(journal+'.lock/owner.json',JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'});
  const digest=createHash('sha256').update(JSON.stringify(config)).digest('hex');
  try{state=await privateJSON(journal);if(state.configSha256!==digest)fail('LIVE_JOURNAL_SCOPE_CHANGED');}catch(e){if(e.code!=='ENOENT')throw e;state={runId:randomUUID(),configSha256:digest,startedAt:new Date().toISOString()};}
  save=async s=>{const temp=journal+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(s,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,journal);};await save(state);
  owner=customerClient(config.origin,controller.signal);foreign=customerClient(config.origin,controller.signal);anonymous=customerClient(config.origin,controller.signal);
  const a=await owner.request('/api/auth/sign-in/email',{email:credentials.email,password:credentials.password}),b=await foreign.request('/api/auth/sign-in/email',{email:credentials.foreignEmail,password:credentials.foreignPassword});
  if(a.status!==200||b.status!==200||a.body.user.id===b.body.user.id)fail('LIVE_DISTINCT_VERIFIED_ACCOUNTS_REQUIRED');
  if(state.ownerId&&(state.ownerId!==a.body.user.id||state.foreignId!==b.body.user.id))fail('LIVE_JOURNAL_ACTOR_CHANGED');Object.assign(state,{ownerId:a.body.user.id,foreignId:b.body.user.id});await save(state);
  const result=await creativeAcceptance({api:owner.request,foreign:foreign.request,anonymous:anonymous.request,media:u=>imageBytes(u,config.mediaOrigins,controller.signal),save,wait:ms=>wait(ms,undefined,{signal:controller.signal})},config,state);
  const report={checked_at:new Date().toISOString(),passed:result.status==='passed',mode:'staging',live_customer_api_calls:true,...result};
  const evidenceTemp=journal+'.'+randomUUID()+'.evidence.tmp';await writeFile(evidenceTemp,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(evidenceTemp,journal+'.evidence.json');
  console.log(JSON.stringify({status:result.status,threadId:state.threadId,businessId:config.businessId,evidence_file:journal+'.evidence.json',next:result.status==='passed'?'Creative acceptance passed; full release, video and publishing acceptance are separate.':'Open this business’s Canvas, select the staging acceptance conversation, inspect and approve the exact saved creative, then rerun with this same journal. No additional generation is submitted on resume.'}));return result.status==='passed'?0:3;
 }catch(e){const code=/^LIVE_[A-Z0-9_]+$/.test(e.message)?e.message:e.code==='EEXIST'?'LIVE_JOURNAL_LOCKED':'LIVE_CHECK_FAILED';if(state&&save){state.lastError=code;await save(state).catch(()=>{});}console.error(code);return 2;}
 finally{await Promise.allSettled([owner?.close(),foreign?.close(),anonymous?.close()]);if(locked)await rm(journal+'.lock',{recursive:true});process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
