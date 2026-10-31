import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {resolveIngressAddress} from '../../dist/auth-ingress.js';

test('built Next proxy replaces caller proofs and preserves API requests', {timeout:60000}, async()=>{
 const secret='de'.repeat(32);let child;
 // The default production build fixes API_ORIGIN at loopback:3100.
 const upstream=createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({ip:resolveIngressAddress(req.headers,'socket-peer',req.method,new URL(req.url,'http://local').pathname,secret),cookie:req.headers.cookie,rawPeer:req.headers['x-desvio-peer-ip']}));
 });
 const reservation=createServer();
 try {
  await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(3100,'127.0.0.1',resolve);});
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','-H','127.0.0.1','-p',String(port)],{env:{...process.env,AUTH_INGRESS_SECRET:secret,TRUST_RAILWAY_EDGE:'true'},stdio:'ignore'});
  const url=`http://127.0.0.1:${port}/api/auth/sign-in/email?test=one%20two`;let response;
  for(let n=0;n<100;n++) {
   if(child.exitCode!==null)throw Error('Web server exited before readiness');
   try{response=await fetch(url,{method:'POST',headers:{'x-real-ip':'198.51.100.20','x-desvio-client-ip':'198.51.100.99','x-desvio-client-signature':'0'.repeat(64),'x-desvio-peer-ip':'198.51.100.98',cookie:'fixture=preserved'}});break;}catch{await delay(200);}
  }
  assert.ok(response);assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ip:'198.51.100.20',cookie:'fixture=preserved'});
  assert.equal(response.headers.get('x-desvio-client-signature'),null);
  const missing=await fetch(url);assert.equal(missing.status,503);await missing.body?.cancel();
  const list=await fetch(url,{headers:{'x-real-ip':'198.51.100.1,198.51.100.2'}});assert.equal(list.status,503);await list.body?.cancel();
 }finally{
  if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await ended;}
  await new Promise(resolve=>upstream.close(resolve));
  if(reservation.listening)await new Promise(resolve=>reservation.close(resolve));
 }
});
