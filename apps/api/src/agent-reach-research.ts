/** Agent Reach research step of a website.extract job. Runs beside the GPT website capture and the
 * GPT market research, inside a hard time limit, and never fails research: a refused, failed or
 * slow channel only leaves fewer pages. Each call is written to app.agent_reach_calls before it
 * runs; a read already made for this business in the last 24 hours is reused from there. */
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {AgentReachRefused,REACH_LIMITS,dedupePages,followUps,initialTasks,parseEnvelope,reachInput,reachProvider,reachTask,sizeEvidence,taskKey,taskTarget,withinBounds,type ReachEnvelope,type ReachInput,type ReachPage,type ReachTask} from './agent-reach-contract.js';
import type {ReachSession,ReachTransport} from './agent-reach-sandbox.js';
import {logActivityFailure} from './activity-log.js';
import type {GuidedBrief} from './guided-campaign-contracts.js';
import type {AssetJobs,JobScope} from './jobs.js';
import {IntakeError,SafeWeb,websiteURL} from './safe-web.js';

const robotsParser=createRequire(import.meta.url)('robots-parser') as (url:string,text:string)=>{isAllowed:(url:string,agent:string)=>boolean|undefined};

export type ReachSummary={status:'completed'|'partial'|'skipped'|'unavailable';code?:string;calls:number;cached:number;failed:number;refused:number;own_pages:number;market_pages:number;elapsed_ms:number};
export type ReachRun={ownPages:ReachPage[];marketPages:ReachPage[];summary:ReachSummary};
export type RunOptions={
 /** Settles when the other research branches have; Agent Reach then gets only the grace period. */
 stopWhen?:Promise<unknown>;
 /** Called once, as soon as a page of the business's own site has been read. */
 onOwnPage?:()=>void;
};
/** robots.txt as the existing crawler reads it: 404/410 allow, 200 is parsed for DesvioBot,
 * anything else (or no answer) refuses. Cached per origin for one run. */
export type RobotsGate={allowed(url:string):Promise<boolean>};
export class SafeWebRobots implements RobotsGate{
 private readonly rules=new Map<string,Promise<ReturnType<typeof robotsParser>|null|false>>();
 constructor(readonly web:Pick<SafeWeb,'fetch'>=new SafeWeb()){}
 async allowed(raw:string):Promise<boolean>{
  const url=websiteURL(raw,true);
  if(!this.rules.has(url.origin))this.rules.set(url.origin,(async()=>{
   try{const robots=new URL('/robots.txt',url),r=await this.web.fetch(robots,256*1024,'text/plain',4000);
    if(r.status===404||r.status===410)return null;
    return r.status===200?robotsParser(robots.href,r.bytes.toString('utf8')):false;}catch{return false;}
  })());
  const rules=await this.rules.get(url.origin)!;
  return rules!==false&&rules?.isAllowed(url.href,'DesvioBot')!==false;
 }
}
export type ReachConfig={enabled:boolean;transport?:ReachTransport;robots?:()=>RobotsGate;limits?:{totalMs?:number;graceMs?:number}};

type Outcome={kind:'cached';envelope:ReachEnvelope}|{kind:'refused';code:string}|{kind:'submit';row:string};
const empty=(status:ReachSummary['status'],code:string,started:number):ReachRun=>({ownPages:[],marketPages:[],summary:{status,code,calls:0,cached:0,failed:0,refused:0,own_pages:0,market_pages:0,elapsed_ms:Date.now()-started}});

export class AgentReachResearch{
 constructor(readonly config:ReachConfig){}
 get configured():boolean{return this.config.enabled&&!!this.config.transport;}
 async research(jobs:AssetJobs,scope:JobScope,url:string,brief:GuidedBrief|null|undefined,options:RunOptions={}):Promise<ReachRun>{
  const started=Date.now();
  if(!this.config.enabled)return empty('skipped','AGENT_REACH_DISABLED',started);
  if(!this.config.transport)return empty('skipped','AGENT_REACH_NOT_CONFIGURED',started);
  let input:ReachInput;try{input=reachInput(url,brief);}catch{return empty('skipped','AGENT_REACH_INPUT_INVALID',started);}
  try{return await new Run(jobs,scope,input,this.config,options,started).execute();}
  catch(error){logActivityFailure('AgentReachResearch',scope,error);return empty('unavailable',error instanceof IntakeError?error.code:'AGENT_REACH_FAILED',started);}
 }
}

class Run{
 private readonly tasks:ReachTask[]=[];
 private readonly rows=new Map<number,string>();
 private readonly open=new Set<number>();
 private readonly pages:ReachPage[]=[];
 private readonly robots:RobotsGate;
 private counts={calls:0,cached:0,failed:0,refused:0};
 private session?:ReachSession;
 private deadline:number;
 private planning=0;
 private ownSeen=false;
 private closing=false;
 private finished!:()=>void;
 private readonly done=new Promise<void>(resolve=>{this.finished=resolve;});
 constructor(readonly jobs:AssetJobs,readonly scope:JobScope,readonly input:ReachInput,readonly config:ReachConfig,readonly options:RunOptions,readonly started:number){
  this.deadline=started+(config.limits?.totalMs??REACH_LIMITS.totalMs);
  this.robots=config.robots?.()??new SafeWebRobots();
 }
 async execute():Promise<ReachRun>{
  await this.jobs.transaction(this.scope,async(db,j)=>{
   if(j.kind!=='website.extract'||!await this.jobs.permitted(db,j))throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
   // A replayed job never waits for calls of an attempt that died: they are closed, not repeated.
   await db.query("UPDATE app.agent_reach_calls SET status='abandoned',error_code='AGENT_REACH_ATTEMPT_ENDED' WHERE job_id=$1 AND status='submitted'",[j.id]);
  });
  this.session=this.config.transport!.open({result:(id,value)=>void this.settle(id,value),closed:()=>this.finish()});
  let timer=setTimeout(()=>void this.stop(),Math.max(0,this.deadline-Date.now()));
  void this.options.stopWhen?.then(()=>{
   const grace=this.config.limits?.graceMs??REACH_LIMITS.graceMs;
   if(Date.now()+grace<this.deadline){this.deadline=Date.now()+grace;clearTimeout(timer);timer=setTimeout(()=>void this.stop(),grace);}
  },()=>undefined);
  await this.plan(initialTasks(this.input));
  this.maybeEnd();
  await this.done;clearTimeout(timer);this.closing=true;
  await this.session.close();
  await this.abandonOpen();
  const pages=dedupePages(this.pages),own=pages.filter(p=>p.origin==='own'),market=pages.filter(p=>p.origin==='market');
  const timedOut=this.open.size>0||Date.now()>=this.deadline;
  return {ownPages:own,marketPages:market,summary:{status:timedOut?'partial':'completed',...(timedOut?{code:'AGENT_REACH_TIMEOUT'}:{}),...this.counts,own_pages:own.length,market_pages:market.length,elapsed_ms:Date.now()-this.started}};
 }
 private finish(){this.finished();}
 private async stop(){
  if(!this.session||this.closing)return;
  this.closing=true;
  await this.session.close();
  this.finish();
 }
 private maybeEnd(){if(!this.planning&&!this.open.size)this.session?.end();}
 /** Admit drafts within the bounds, then check robots, the cache and the rate limits in parallel. */
 private async plan(drafts:ReturnType<typeof initialTasks>){
  this.planning++;
  try{
   const admitted:ReachTask[]=[];
   for(const draft of drafts){
    if(Date.now()>=this.deadline||this.tasks.length>=64||!withinBounds(this.tasks,draft))continue;
    try{const task=reachTask({...draft,id:this.tasks.length+1,timeout:Math.min(REACH_LIMITS.taskSeconds,Math.floor((this.deadline-Date.now())/1000))});
     if(this.tasks.some(t=>taskKey(t)===taskKey(task)))continue;this.tasks.push(task);admitted.push(task);}
    catch(error){if(error instanceof AgentReachRefused)this.counts.refused++;else throw error;}
   }
   await Promise.all(admitted.map(task=>this.start(task)));
  }finally{this.planning--;this.maybeEnd();}
 }
 private async start(task:ReachTask){
  // Nothing new starts once the run is stopping: a late row would never be settled.
  if(this.closing||Date.now()>=this.deadline)return;
  const robotsOk=task.channel==='web'&&task.action==='read'?await this.robots.allowed(task.params.target!).catch(()=>false):true;
  const outcome=await this.admit(task,robotsOk);
  if(outcome.kind==='refused'){this.counts.refused++;return;}
  if(outcome.kind==='cached'){this.counts.cached++;await this.use(task,outcome.envelope);return;}
  this.rows.set(task.id,outcome.row);this.open.add(task.id);this.counts.calls++;
  if(this.closing||Date.now()>=this.deadline){if(this.closing)await this.abandonOpen();return;}
  this.session!.send(task);
 }
 private admit(task:ReachTask,robotsOk:boolean):Promise<Outcome>{
  return this.jobs.transaction(this.scope,async(db,j):Promise<Outcome>=>{
   if(!await this.jobs.permitted(db,j))throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
   const key=taskKey(task),target=taskTarget(task);
   const record=(status:string,provider:string,code:string|null,items:number|null,result:unknown)=>db.query(
    "INSERT INTO app.agent_reach_calls(id,job_id,organization_id,brand_id,channel,action,purpose,target,target_sha256,provider,status,error_code,items,result,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $11='submitted' THEN NULL ELSE now() END)",
    [randomUUID(),j.id,j.organization_id,j.brand_id,task.channel,task.action,task.purpose,target,key,provider,status,code,items,result===null?null:JSON.stringify(result)]);
   if(!robotsOk){await record('skipped','robots','ROBOTS_DISALLOWED',null,null);return {kind:'refused',code:'ROBOTS_DISALLOWED'};}
   const cached=(await db.query("SELECT result FROM app.agent_reach_calls WHERE organization_id=$1 AND brand_id=$2 AND target_sha256=$3 AND status='succeeded' AND created_at>now()-interval '24 hours' ORDER BY created_at DESC LIMIT 1",[j.organization_id,j.brand_id,key])).rows[0];
   if(cached?.result){
    try{const envelope=parseEnvelope(cached.result,task);await record('cached','cache',null,envelope.items.length,null);return {kind:'cached',envelope};}catch{/* An unreadable cache entry is fetched again. */}
   }
   const room=Number((await db.query('SELECT app.agent_reach_capacity($1,$2,1) AS n',[j.organization_id,j.brand_id])).rows[0].n);
   if(room<1){await record('skipped','limit','AGENT_REACH_RATE_LIMITED',null,null);return {kind:'refused',code:'AGENT_REACH_RATE_LIMITED'};}
   const row=randomUUID();
   await db.query("INSERT INTO app.agent_reach_calls(id,job_id,organization_id,brand_id,channel,action,purpose,target,target_sha256,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted')",[row,j.id,j.organization_id,j.brand_id,task.channel,task.action,task.purpose,target,key]);
   return {kind:'submit',row};
  });
 }
 private async settle(id:number,value:unknown){
  const task=this.tasks.find(t=>t.id===id),row=this.rows.get(id);
  if(!task||!row||!this.open.has(id))return;
  let envelope:ReachEnvelope;
  try{envelope=parseEnvelope(value,task);}catch{envelope={ok:false,channel:task.channel,action:task.action,backend:null,items:[],error:{code:'AGENT_REACH_OUTPUT_INVALID',message:''},attempts:[]};}
  try{
   const result={schema_version:1,ok:envelope.ok,channel:task.channel,action:task.action,backend:envelope.backend,items:envelope.items,meta:{attempts:envelope.attempts},error:envelope.error};
   const bytes=Buffer.byteLength(JSON.stringify(envelope.items));
   await this.jobs.transaction(this.scope,db=>db.query('UPDATE app.agent_reach_calls SET status=$2,provider=$3,error_code=$4,items=$5,bytes=$6,result=$7 WHERE id=$1',
    [row,envelope.ok?'succeeded':'failed',this.provider(envelope),envelope.ok?null:envelope.error!.code.replace(/[^A-Z0-9_]/g,'').slice(0,60)||'UPSTREAM_BROKEN',envelope.items.length,bytes,envelope.ok&&bytes<=150000?JSON.stringify(result):null]));
  }catch(error){logActivityFailure('AgentReachLedger',this.scope,error);}
  this.open.delete(id);
  if(!envelope.ok)this.counts.failed++;
  await this.use(task,envelope);
  this.maybeEnd();
 }
 private provider(envelope:ReachEnvelope):string|null{
  const backend=envelope.backend??envelope.attempts.at(-1)?.backend??null;
  return backend===null?null:reachProvider({channel:envelope.channel,backend});
 }
 private async use(task:ReachTask,envelope:ReachEnvelope){
  const pages=sizeEvidence(task,envelope,this.input.website,new Date().toISOString());
  this.pages.push(...pages);
  if(!this.ownSeen&&pages.some(p=>p.origin==='own')){this.ownSeen=true;this.options.onOwnPage?.();}
  const next=followUps(task,envelope,this.input);
  if(next.length&&Date.now()<this.deadline)await this.plan(next);
 }
 private async abandonOpen(){
  if(!this.open.size)return;
  const ids=[...this.open].map(id=>this.rows.get(id)!);
  await this.jobs.transaction(this.scope,db=>db.query("UPDATE app.agent_reach_calls SET status='abandoned',error_code='AGENT_REACH_TIMEOUT' WHERE id=ANY($1::uuid[]) AND status='submitted'",[ids])).catch(error=>logActivityFailure('AgentReachLedger',this.scope,error));
 }
}
