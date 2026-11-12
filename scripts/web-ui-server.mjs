// Production build of the web app on a private loopback port, for browser suites whose
// tests mock every /api request in the page (DESVIO_UI_BASE). No API or provider is reached.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {port} from './storage-test-services.mjs';

const NEXT='node_modules/next/dist/bin/next';
const READY_MS=120000;

function run(args,env,onOutput){
 const child=spawn(process.execPath,[NEXT,...args],{env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',...env},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>onOutput(String(b)));child.stderr.on('data',b=>onOutput(String(b)));
 return child;
}

/** Build and start the web app. Returns its origin and a close function. */
export async function startWebUI(){
 let logs='';const keep=s=>{logs=(logs+s).slice(-6000);};
 // The API origin is never contacted: the suites answer /api in the browser. A closed loopback port keeps it local.
 const env={API_ORIGIN:`http://127.0.0.1:${await port()}`};
 const build=run(['build','apps/web','--webpack'],env,keep);
 const [code]=await once(build,'exit');
 if(code!==0)throw new Error(`Web build failed:\n${logs}`);
 const origin=`http://127.0.0.1:${await port()}`;
 const server=run(['start','apps/web','-H','127.0.0.1','-p',new URL(origin).port],env,keep);
 const close=async()=>{if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit').catch(()=>{});}};
 for(const deadline=Date.now()+READY_MS;Date.now()<deadline;){
  if(server.exitCode!==null)break;
  try{if((await fetch(`${origin}/sign-in`)).ok)return {origin,close};}catch{/* Not listening yet. */}
  await delay(250);
 }
 await close();
 throw new Error(`Web server did not become ready:\n${logs}`);
}
