// Runs the whole Desvio product on this machine for a browser at http://127.0.0.1:3000.
//
//   node scripts/local-stack.mjs start [--mock|--live --spend-cap-usd N] [--seed] [--web-port N] [--with-video] [--rebuild]
//   node scripts/local-stack.mjs status | stop | seed | journey [--headed] | mail | logs [name] | reset --yes
//
// Development mode only, loopback only. Data persists under work/local-stack (git-ignored).
// See docs/LOCAL_RUN.md.
import {spawn,execFileSync} from 'node:child_process';
import {openSync,existsSync,statSync,readdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:net';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {ROOT,STACK_DIR,PATHS,DEFAULT_PORTS,CONTAINERS,ensureDirectories,loadSecrets,readState,writeState,webEnvironment} from './local-stack/config.mjs';

const out=line=>process.stdout.write(line+'\n');
const fail=message=>{process.stderr.write(`local-stack: ${message}\n`);process.exit(1);};

export function parseArgs(argv){
 const [command='start',...rest]=argv;
 const options={command,mode:'mock',seed:false,withVideo:false,rebuild:false,spendCapUsd:null,webPort:DEFAULT_PORTS.web,yes:false,headed:false,names:[]};
 for(let i=0;i<rest.length;i++){
  const arg=rest[i],next=()=>{const value=rest[++i];if(value===undefined)throw new Error(`${arg} needs a value`);return value;};
  if(arg==='--mock')options.mode='mock';
  else if(arg==='--live')options.mode='live';
  else if(arg==='--seed')options.seed=true;
  else if(arg==='--with-video')options.withVideo=true;
  else if(arg==='--rebuild')options.rebuild=true;
  else if(arg==='--yes')options.yes=true;
  else if(arg==='--headed')options.headed=true;
  else if(arg==='--spend-cap-usd'){const v=Number(next());if(!Number.isFinite(v)||v<=0||v>1000)throw new Error('--spend-cap-usd must be a number of dollars between 0 and 1000');options.spendCapUsd=v;}
  else if(arg==='--web-port'){const v=Number(next());if(!Number.isInteger(v)||v<1024||v>65535)throw new Error('--web-port must be a port from 1024 to 65535');options.webPort=v;}
  else if(!arg.startsWith('--'))options.names.push(arg);
  else throw new Error(`Unknown option ${arg}`);
 }
 if(options.mode==='live'&&options.command==='start'&&options.spendCapUsd===null)throw new Error('--live requires an explicit --spend-cap-usd (per-business lifetime cap in dollars)');
 if(options.mode==='mock'&&options.spendCapUsd!==null)throw new Error('--spend-cap-usd applies to --live only');
 return options;
}

function supervisorAlive(state){
 if(!state?.supervisor)return false;
 try{process.kill(state.supervisor,0);return true;}catch{return false;}
}
function portFree(port){
 return new Promise(resolve=>{const s=createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});
}
function dockerReady(){
 try{execFileSync('docker',['info','--format','{{.ServerVersion}}'],{stdio:['ignore','pipe','pipe'],timeout:20000});return true;}catch{return false;}
}

function newest(dir,pattern){
 let latest=0;
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())latest=Math.max(latest,newest(path,pattern));
  else if(pattern.test(entry.name))latest=Math.max(latest,statSync(path).mtimeMs);
 }
 return latest;
}
function run(label,command,args,env=process.env){
 const log=openSync(join(PATHS.logs,`${label}.log`),'a');
 try{execFileSync(command,args,{cwd:ROOT,env,stdio:['ignore',log,log],timeout:1800000});}
 catch{throw new Error(`${label} failed; see work/local-stack/logs/${label}.log`);}
}
function buildServer(force){
 const dist=join(ROOT,'dist/worker-main.js');
 if(!force&&existsSync(dist)&&statSync(dist).mtimeMs>=newest(join(ROOT,'apps/api/src'),/\.ts$/))return 'up to date';
 run('build','npm',['run','build']);return 'built';
}
function buildWeb(context,force){
 const env=webEnvironment(context);
 const git=args=>{try{return execFileSync('git',args,{cwd:ROOT,encoding:'utf8'});}catch{return '';}};
 const stamp=createHash('sha256').update(JSON.stringify([env.API_ORIGIN,env.S3_BROWSER_ORIGIN,git(['rev-parse','HEAD']),git(['status','--porcelain','apps/web','apps/api/src']).split('\n').filter(l=>!l.endsWith('next-env.d.ts')).join('\n')])).digest('hex');
 const previous=existsSync(PATHS.webBuild)?JSON.parse(readFileSync(PATHS.webBuild,'utf8')).stamp:null;
 if(!force&&previous===stamp&&existsSync(join(ROOT,'apps/web/.next/BUILD_ID')))return 'up to date';
 run('web-build',process.execPath,['node_modules/next/dist/bin/next','build','apps/web','--webpack'],env);
 writeFileSync(PATHS.webBuild,JSON.stringify({stamp,builtAt:new Date().toISOString()})+'\n');
 return 'built';
}

function liveKeyReport(){
 const keys=['OPENAI_API_KEY','VECTEEZY_API_KEY','VECTEEZY_ACCOUNT_ID','POSTFORME_API_KEY'];
 return keys.map(k=>`${k}=${process.env[k]?.trim()?'set':'not set'}`).join(', ');
}

async function start(options){
 ensureDirectories();
 const prior=readState();
 if(supervisorAlive(prior)){
  if(prior.mode!==options.mode)fail(`the stack is already running in ${prior.mode} mode; stop it first`);
  out(`Already running (${prior.mode}). Ready: http://127.0.0.1:${prior.ports.web}`);
  if(options.seed)await seed(prior);
  return;
 }
 if(options.mode==='live'&&!process.env.OPENAI_API_KEY?.trim())fail('--live needs OPENAI_API_KEY exported in this shell');
 if(!dockerReady())fail('Docker is not running');
 const ports={...DEFAULT_PORTS,web:options.webPort};
 const ours=new Set(Object.values(CONTAINERS).filter(name=>{try{return execFileSync('docker',['inspect','--format','{{.State.Running}}',name],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()==='true';}catch{return false;}}).map(name=>({[CONTAINERS.postgres]:'postgres',[CONTAINERS.storage]:'storage',[CONTAINERS.scanner]:'scanner'})[name]));
 const busy=[];
 for(const [name,port] of Object.entries(ports)){if(name==='mock'&&options.mode!=='mock')continue;if(!ours.has(name)&&!await portFree(port))busy.push(`${name} ${port}`);}
 if(busy.length)fail(`these loopback ports are in use: ${busy.join(', ')}.${busy.some(b=>b.startsWith('web '))?' Pick another web port with --web-port.':''}`);

 const started=Date.now();
 out(`Desvio local stack (${options.mode} mode)${options.mode==='live'?` — live keys: ${liveKeyReport()}; spend cap $${options.spendCapUsd} per business`:''}`);
 const secrets=loadSecrets();
 const context={mode:options.mode,ports,secrets,spendCapUsd:options.spendCapUsd,stock:options.mode==='live'&&!!process.env.VECTEEZY_API_KEY?.trim(),images:{}};
 const {startPostgres,startStorage,startScanner,waitForScanner}=await import('./local-stack/containers.mjs');
 const {bootstrap}=await import('./local-stack/database.mjs');
 const {prepareImages}=await import('./local-stack/images.mjs');
 const {runtimeArchitecture}=await import('./runtime-architecture.mjs');
 out(`  server build    ${buildServer(options.rebuild)}`);
 out(`  postgres        ${await startPostgres(context)} on 127.0.0.1:${ports.postgres}`);
 const db=await bootstrap(context);
 out(`  database        ${db.replayed?'roles verified, migrations up to date':'roles created, all migrations applied'}`);
 out(`  storage         ${await startStorage(context)} on 127.0.0.1:${ports.storage}`);
 out(`  scanner         ${startScanner(context)} (signature refresh continues in the background)`);
 const reuse=!options.rebuild&&prior?.images&&Object.values(prior.images).every(d=>{try{execFileSync('docker',['image','inspect',d],{stdio:'ignore'});return true;}catch{return false;}})&&(!options.withVideo||prior.images.video);
 if(reuse){context.images=prior.images;out('  images          reused (use --rebuild to rebuild)');}
 else{
  out('  images          building (first run can take several minutes; log: work/local-stack/logs/images.log)');
  const {images,failed}=await prepareImages({withVideo:options.withVideo,architecture:runtimeArchitecture()},out);
  if(failed.length)fail(`image build failed for ${failed.join(', ')}; see work/local-stack/logs/images.log`);
  context.images=images;
 }
 out(`  web build       ${buildWeb(context,options.rebuild)}`);
 out('  scanner         waiting for signatures…');
 await waitForScanner(context);
 const {secrets:_secrets,...persisted}=context;
 writeState({...persisted,startedAt:new Date().toISOString(),supervisor:null,ready:false});
 const log=openSync(join(PATHS.logs,'supervisor.log'),'a');
 const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'__supervise'],{cwd:ROOT,detached:true,stdio:['ignore',log,log],env:process.env});
 child.unref();
 for(const deadline=Date.now()+600000;Date.now()<deadline;){
  await sleep(1000);
  const state=readState();
  if(state?.ready)break;
  if(state?.error||child.exitCode!==null||(state?.supervisor===null&&Date.now()-started>5000&&!supervisorAlive({supervisor:child.pid})))fail(`start-up failed: ${state?.error??'supervisor exited'}; see work/local-stack/logs/stack.log`);
 }
 const state=readState();
 if(!state?.ready)fail('the stack did not become ready in 10 minutes; see work/local-stack/logs/stack.log');
 out(`  processes       temporal, api, worker (+dispatcher), web${options.mode==='mock'?', mock providers':''}, mail sink`);
 out(`  took            ${Math.round((Date.now()-started)/1000)}s`);
 if(options.seed)await seed(state);
 out(`\nReady: http://127.0.0.1:${ports.web}`);
 out('Sign-up emails (verification links) are caught locally: node scripts/local-stack.mjs mail');
}

async function seed(state){
 const {seedOperator}=await import('./local-stack/seed.mjs');
 const result=await seedOperator({...state,secrets:loadSecrets()});
 out(`\nSeeded a verified operator (shown once, not stored):\n  email:    ${result.email}\n  password: ${result.password}`);
}

async function status(){
 const state=readState();
 if(!state){out('Not set up. Run: node scripts/local-stack.mjs start');return;}
 const {checkAll,containerSummary}=await import('./local-stack/health.mjs');
 const alive=supervisorAlive(state);
 out(`Mode: ${state.mode}   supervisor: ${alive?`running (pid ${state.supervisor})`:'stopped'}   ready: ${alive&&state.ready?'yes':'no'}`);
 const health=await checkAll({...state,secrets:loadSecrets()});
 for(const [name,ok] of Object.entries(health))if(ok!==null)out(`  ${name.padEnd(9)} ${ok?'healthy':'down'}`);
 out(`  containers ${JSON.stringify(containerSummary())}`);
 if(state.failed?.length)out(`  exited unexpectedly: ${state.failed.join(', ')} (see work/local-stack/logs)`);
 if(alive&&state.ready)out(`Open: http://127.0.0.1:${state.ports.web}`);
}

async function stop(){
 const state=readState();
 if(supervisorAlive(state)){
  process.kill(state.supervisor,'SIGTERM');
  for(let i=0;i<60&&supervisorAlive(state);i++)await sleep(500);
  if(supervisorAlive(state))process.kill(state.supervisor,'SIGKILL');
 }
 const {removeContainer}=await import('./local-stack/containers.mjs');
 for(const name of Object.values(CONTAINERS))if(removeContainer(name))out(`  removed container ${name} (data kept in work/local-stack)`);
 if(state)writeState({...state,supervisor:null,ready:false});
 out('Stopped.');
}

function mail(){
 const file=join(PATHS.mail,'messages.jsonl');
 if(!existsSync(file)){out('No local email yet.');return;}
 const lines=readFileSync(file,'utf8').split('\n').filter(Boolean).slice(-10).map(l=>JSON.parse(l));
 for(const m of lines)out(`${m.at}  ${m.to}  "${m.subject}"${m.link?`\n    ${m.link}`:''}`);
}

function logs(names){
 const name=names[0]??'stack';
 const file=join(PATHS.logs,`${name}.log`);
 if(!existsSync(file))fail(`no log named ${name}; available: ${readdirSync(PATHS.logs).map(f=>f.replace(/\.log$/,'')).join(', ')}`);
 out(readFileSync(file,'utf8').split('\n').slice(-80).join('\n'));
}

async function reset(options){
 if(!options.yes)fail('reset deletes the local database, stored files and generated secrets; re-run with --yes');
 await stop();
 const target=resolve(STACK_DIR);
 if(!target.endsWith(join('work','local-stack')))fail('unexpected stack directory');
 rmSync(target,{recursive:true,force:true});
 out('Local stack data removed. The next start creates a fresh database and new secrets.');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let options;
 try{options=parseArgs(process.argv.slice(2));}catch(error){fail(error.message);}
 try{
  if(options.command==='__supervise'){const {supervise}=await import('./local-stack/supervisor.mjs');await supervise();}
  else if(options.command==='start')await start(options);
  else if(options.command==='status')await status();
  else if(options.command==='stop')await stop();
  else if(options.command==='mail')mail();
  else if(options.command==='logs')logs(options.names);
  else if(options.command==='reset')await reset(options);
  else if(options.command==='journey'){
   const state=readState();if(!supervisorAlive(state)||!state.ready)fail('start the stack first');
   const {runJourney}=await import('./local-stack/journey.mjs');
   const {results,shots}=await runJourney(state,{headed:options.headed});
   out(`\n${results.filter(r=>r.ok).length}/${results.length} steps passed; screenshots in ${shots}`);
   if(results.some(r=>!r.ok))process.exitCode=1;
  }
  else if(options.command==='seed'){const state=readState();if(!supervisorAlive(state)||!state.ready)fail('start the stack first');await seed(state);}
  else fail(`unknown command ${options.command}; use start, status, stop, seed, journey, mail, logs or reset`);
 }catch(error){fail(error instanceof Error?error.message:'unexpected error');}
}
