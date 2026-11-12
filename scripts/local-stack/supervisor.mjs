// The long-lived local-stack process. It owns the mail sink, the mock providers (mock mode),
// the Temporal dev server, the API, the worker (with its job dispatcher) and the web app,
// renews provider grants, and stops all of them on SIGTERM. Logs go to work/local-stack/logs.
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT,PATHS,TEMPORAL_NAMESPACE,readState,writeState,loadSecrets,apiEnvironment,workerEnvironment,webEnvironment} from './config.mjs';
import {startMailSink} from './mail-sink.mjs';
import {startMockProviders} from './mock-providers.mjs';
import {temporalBinary} from '../storage-test-services.mjs';
import {probes} from './health.mjs';
import {adminPool} from './containers.mjs';
import {refreshGrants} from './database.mjs';

const log=createWriteStream(join(PATHS.logs,'stack.log'),{flags:'a'});
const say=line=>log.write(`[${new Date().toISOString()}] ${line}\n`);
const children=new Map();
let stopping=false;

function update(patch){writeState({...readState(),...patch});}

function launch(name,command,args,env){
 const out=createWriteStream(join(PATHS.logs,`${name}.log`),{flags:'a'});
 out.write(`\n----- ${new Date().toISOString()} starting ${name} -----\n`);
 const child=spawn(command,args,{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(out,{end:false});child.stderr.pipe(out,{end:false});
 child.on('exit',(code,signal)=>{
  out.write(`----- ${name} exited (${signal??code}) -----\n`);
  children.delete(name);
  if(!stopping){say(`${name} exited unexpectedly (${signal??code}); see logs/${name}.log`);update({failed:[...new Set([...(readState()?.failed??[]),name])]});}
 });
 children.set(name,child);
 return child;
}

async function waitFor(name,probe,context,timeoutMs){
 for(const deadline=Date.now()+timeoutMs;Date.now()<deadline;){
  if(stopping)throw new Error('stopping');
  if(!children.has(name)&&['temporal','api','worker','web'].includes(name))throw new Error(`${name} exited during start-up; see work/local-stack/logs/${name}.log`);
  if(await probe(context))return;
  await sleep(500);
 }
 throw new Error(`${name} was not healthy within ${Math.round(timeoutMs/1000)}s; see work/local-stack/logs/${name}.log`);
}

async function stopAll(){
 stopping=true;
 const pending=[...children.entries()].reverse().map(([name,child])=>new Promise(resolve=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');},8000);
  child.once('exit',()=>{clearTimeout(timer);resolve();});
  child.kill('SIGTERM');say(`stopping ${name}`);
 }));
 await Promise.all(pending);
}

export async function supervise(){
 const state=readState();
 if(!state)throw new Error('No local-stack state; use "node scripts/local-stack.mjs start"');
 const context={...state,secrets:loadSecrets(),liveKeys:process.env};
 update({supervisor:process.pid,ready:false,failed:[],error:null});
 const closers=[];
 const shutdown=async signal=>{
  if(stopping)return;say(`received ${signal}; stopping`);
  await stopAll();for(const close of closers)await close().catch(()=>{});
  update({supervisor:null,ready:false,stoppedAt:new Date().toISOString()});log.end();process.exit(0);
 };
 process.on('SIGTERM',()=>void shutdown('SIGTERM'));process.on('SIGINT',()=>void shutdown('SIGINT'));
 try{
  closers.push((await startMailSink(context.ports.smtp,say)).close);
  if(context.mode==='mock')closers.push((await startMockProviders(context.ports.mock,say)).close);
  const temporal=await temporalBinary();
  launch('temporal',temporal,['server','start-dev','--ip','127.0.0.1','-p',String(context.ports.temporal),'--http-port',String(context.ports.temporalHttp),'--metrics-port',String(context.ports.temporalMetrics),
   '--headless','-n',TEMPORAL_NAMESPACE,'-f',join(PATHS.temporal,'temporal.db'),'--log-level','error'],{PATH:process.env.PATH,HOME:process.env.HOME});
  await waitFor('temporal',probes.temporal,context,60000);say('temporal ready');
  launch('api',process.execPath,['dist/main.js'],apiEnvironment(context));
  await waitFor('api',probes.api,context,60000);say('api ready');
  launch('worker',process.execPath,['dist/worker-main.js'],workerEnvironment(context));
  await waitFor('worker',probes.worker,context,90000);say('worker ready');
  launch('web',process.execPath,['node_modules/next/dist/bin/next','start','apps/web','-H','127.0.0.1','-p',String(context.ports.web)],webEnvironment(context));
  await waitFor('web',probes.web,context,90000);say('web ready');
  const pool=adminPool(context,2);closers.push(()=>pool.end());
  const renew=async()=>{try{const applied=await refreshGrants(context,pool);if(applied.length)say(`grants applied: ${applied.join(', ')}`);}catch(error){say(`grant renewal failed: ${error.code??error.message}`);}};
  await renew();
  // Every second: a new account gets its operator defaults before its owner can add a business.
  let renewing=false;
  const timer=setInterval(()=>{if(stopping||renewing)return;renewing=true;void renew().finally(()=>{renewing=false;});},1000);closers.push(async()=>clearInterval(timer));
  update({ready:true,readyAt:new Date().toISOString(),pids:Object.fromEntries([...children].map(([n,c])=>[n,c.pid]))});
  say('stack ready');
 }catch(error){
  say(`start-up failed: ${error.message}`);update({error:error.message});
  await shutdown('start-up failure');
 }
}
