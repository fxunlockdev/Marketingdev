/** How tasks reach Agent Reach: the pinned sandbox image (production), a loopback mock server
 * (local stack, development and test only) or an in-process transport (tests). */
import {spawn,execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {promisify} from 'node:util';
import {REACH_LIMITS,RUNNER_VERSION,type ReachTask} from './agent-reach-contract.js';

/** One open Agent Reach session. Results arrive by task id; `close` ends it, keeping what arrived. */
export type ReachSession={send(task:ReachTask):void;end():void;close():Promise<void>};
export type ReachHandlers={result(id:number,envelope:unknown):void;closed(code:string|null):void};
export type ReachTransport={readonly kind:'sandbox'|'mock_server'|'in_process';open(handlers:ReachHandlers):ReachSession};

const LOOPBACK=['127.0.0.1','localhost','[::1]'];
const MAX_OUTPUT_BYTES=8*1024*1024;

/** Docker flags of the research sandbox. Networked (it must reach Jina, Exa and YouTube) but with
 * no credentials, no Docker socket, a read-only root, an empty temporary home and bounded
 * CPU, memory, processes and time. */
export function sandboxArgs(image:string,name:string):string[]{
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('AGENT_REACH_IMAGE must be an exact local image digest');
 return ['run','--rm','-i','--name',name,'--label','desvio.purpose=agent-reach-sandbox','--network','bridge','--read-only','--cap-drop=ALL',
  '--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--memory-swap','768m','--cpus','1','--user','65534:65534',
  '--tmpfs','/tmp:rw,noexec,nosuid,size=128m','--env','HOME=/tmp/home','--stop-timeout','2',image];
}

export class SandboxTransport implements ReachTransport{
 readonly kind='sandbox';
 constructor(readonly image:string){sandboxArgs(image,'check');}
 open(handlers:ReachHandlers):ReachSession{
  const name=`desvio-agent-reach-${randomUUID()}`;
  const child=spawn('docker',sandboxArgs(this.image,name),{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});
  const decoder=new StringDecoder('utf8');let pending='',total=0,closed=false,ready=false;const queue:string[]=[];
  const finish=(code:string|null)=>{if(closed)return;closed=true;child.stdin.destroy();handlers.closed(code);};
  const write=(line:string)=>{if(closed)return;if(ready)child.stdin.write(line+'\n');else queue.push(line);};
  child.on('error',()=>finish('AGENT_REACH_UNAVAILABLE'));child.stdin.on('error',()=>{});child.stderr.resume();
  child.stdout.on('data',(chunk:Buffer)=>{
   total+=chunk.length;if(total>MAX_OUTPUT_BYTES){child.kill('SIGKILL');return finish('AGENT_REACH_OUTPUT_LIMIT');}
   pending+=decoder.write(chunk);let at:number;
   while((at=pending.indexOf('\n'))>=0){
    const line=pending.slice(0,at);pending=pending.slice(at+1);let message:{type?:unknown;id?:unknown;envelope?:unknown;version?:unknown};
    try{message=JSON.parse(line);}catch{child.kill('SIGKILL');return finish('AGENT_REACH_OUTPUT_INVALID');}
    if(message.type==='ready'&&message.version===RUNNER_VERSION&&!ready){ready=true;for(const l of queue.splice(0))child.stdin.write(l+'\n');continue;}
    if(message.type==='result'&&Number.isSafeInteger(message.id))handlers.result(message.id as number,message.envelope);
    else{child.kill('SIGKILL');return finish('AGENT_REACH_OUTPUT_INVALID');}
   }
  });
  child.on('close',code=>finish(code===0?null:'AGENT_REACH_SANDBOX_FAILED'));
  return {
   send:task=>write(JSON.stringify({id:task.id,channel:task.channel,action:task.action,params:task.params,timeout:task.timeout})),
   end:()=>write(JSON.stringify({type:'end'})),
   close:async()=>{if(!closed){child.kill('SIGKILL');finish('AGENT_REACH_STOPPED');}await promisify(execFile)('docker',['rm','-f',name],{timeout:10000}).catch(()=>{});},
  };
 }
}

/** The local stack's mock (scripts/local-stack/mock-providers.mjs). Only in development or test,
 * only on loopback: it never forwards anything. */
export function mockServerOrigin(value:string|undefined,mode:string|undefined):string|undefined{
 const raw=value?.trim();if(!raw)return undefined;
 if(!['development','test'].includes(mode??''))throw new Error('AGENT_REACH_MOCK_URL is allowed only when APP_MODE is development or test');
 let u:URL;try{u=new URL(raw);}catch{throw new Error('AGENT_REACH_MOCK_URL must be a loopback origin');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!LOOPBACK.includes(u.hostname))throw new Error('AGENT_REACH_MOCK_URL must be a loopback origin');
 return u.origin;
}
export class MockServerTransport implements ReachTransport{
 readonly kind='mock_server';
 constructor(readonly origin:string){}
 open(handlers:ReachHandlers):ReachSession{
  const controller=new AbortController();let open=0,ended=false,closed=false;
  const done=()=>{if(!closed&&ended&&!open){closed=true;handlers.closed(null);}};
  return {
   send:task=>{open++;void fetch(`${this.origin}/agent-reach/v1/task`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:task.channel,action:task.action,params:task.params}),signal:controller.signal})
    .then(r=>r.json()).then(envelope=>{if(!closed)handlers.result(task.id,envelope);},()=>{if(!closed)handlers.result(task.id,null);}).finally(()=>{open--;done();});},
   end:()=>{ended=true;done();},
   close:async()=>{controller.abort();if(!closed){closed=true;handlers.closed('AGENT_REACH_STOPPED');}},
  };
 }
}

/** In-process transport around an envelope function, for tests. Respects `close`. */
export class InProcessTransport implements ReachTransport{
 readonly kind='in_process';
 readonly sent:ReachTask[]=[];
 constructor(readonly answer:(task:ReachTask)=>Promise<unknown>,readonly concurrency=REACH_LIMITS.concurrency){}
 open(handlers:ReachHandlers):ReachSession{
  let running=0,ended=false,closed=false;const waiting:ReachTask[]=[];
  const pump=()=>{
   while(!closed&&running<this.concurrency&&waiting.length){
    const task=waiting.shift()!;running++;
    void this.answer(task).then(v=>v,()=>null).then(envelope=>{running--;if(!closed){handlers.result(task.id,envelope);pump();}});
   }
   if(!closed&&ended&&!running&&!waiting.length){closed=true;handlers.closed(null);}
  };
  return {send:task=>{this.sent.push(task);waiting.push(task);pump();},end:()=>{ended=true;pump();},close:async()=>{if(!closed){closed=true;handlers.closed('AGENT_REACH_STOPPED');}}};
 }
}
