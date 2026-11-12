// Creates a verified local operator through the real sign-up path: sign-up request, the
// verification email captured by the local mail sink, the verification link, sign-in and
// account initialisation. The password is generated here and shown once; it is never stored.
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {mailbox} from './mail-sink.mjs';
import {adminPool} from './containers.mjs';

function cookiesOf(response){
 return (response.headers.getSetCookie?.()??[]).map(c=>c.split(';')[0]).join('; ');
}
async function call(context,path,{method='POST',body,cookie}={}){
 const origin=`http://127.0.0.1:${context.ports.web}`;
 const response=await fetch(`http://127.0.0.1:${context.ports.api}${path}`,{method,redirect:'manual',signal:AbortSignal.timeout(20000),
  headers:{origin,...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return response;
}
async function verificationLink(email,since){
 for(let i=0;i<120;i++){
  const found=mailbox().findLast(m=>m.to.includes(email)&&Date.parse(m.at)>=since&&m.link);
  if(found)return found.link;
  await sleep(500);
 }
 throw new Error('The verification email did not arrive; see work/local-stack/logs/api.log');
}

export async function seedOperator(context){
 const email=`owner-${randomBytes(3).toString('hex')}@example.com`,password=randomBytes(15).toString('base64url'),since=Date.now()-1000;
 const signUp=await call(context,'/api/auth/sign-up/email',{body:{name:'Local Owner',email,password}});
 if(!signUp.ok)throw new Error(`Sign-up failed with HTTP ${signUp.status}`);
 const link=new URL(await verificationLink(email,since));
 const verified=await fetch(`http://127.0.0.1:${context.ports.api}${link.pathname}${link.search}`,{redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(verified.status>=400)throw new Error(`Email verification failed with HTTP ${verified.status}`);
 const signIn=await call(context,'/api/auth/sign-in/email',{body:{email,password}});
 if(!signIn.ok)throw new Error(`Sign-in failed with HTTP ${signIn.status}`);
 const cookie=cookiesOf(signIn);
 const init=await call(context,'/api/v1/accounts/current/initialize',{body:{},cookie});
 if(!init.ok)throw new Error(`Account initialisation failed with HTTP ${init.status}`);
 const {accountId}=await init.json();
 // The supervisor renews grants every few seconds; wait until this account has its defaults.
 const pool=adminPool(context,1);
 try{
  for(let i=0;i<60;i++){
   const {rows}=await pool.query('SELECT 1 FROM app.workspace_provider_defaults WHERE organization_id=$1',[accountId]);
   if(rows.length)return {email,password,accountId};
   await sleep(500);
  }
 }finally{await pool.end();}
 throw new Error('Provider defaults were not applied to the new account; see work/local-stack/logs/stack.log');
}
