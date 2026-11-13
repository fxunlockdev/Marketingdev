// Builds and checks the Agent Reach research sandbox image (apps/agent-reach) from an allowlisted
// context. Agent Reach comes from its git repository at the exact commit in
// infra/agent-reach-image.json (never from PyPI, whose `agent-reach` package is unrelated).
// Usage: node scripts/agent-reach-test-image.mjs   -> builds, verifies offline, prints the digest.
import {runtimeArchitecture,assertRuntimeArchitecture,pythonRuntimeImage,renderRuntimeImage} from './runtime-architecture.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export const AGENT_REACH_PIN=JSON.parse(readFileSync(join(root,'infra/agent-reach-image.json'),'utf8'));
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']}).trim();

/** The pinned source checkout in work/agent-reach (gitignored). Cloned once; verified every time. */
export function agentReachCheckout(){
 const checkout=join(root,'work/agent-reach');
 if(!existsSync(join(checkout,'.git'))){mkdirSync(dirname(checkout),{recursive:true});execFileSync('git',['clone','--quiet','--no-checkout',AGENT_REACH_PIN.repository,checkout],{timeout:300000,stdio:['ignore','pipe','pipe']});}
 try{git(checkout,'cat-file','-e',`${AGENT_REACH_PIN.commit}^{commit}`);}catch{git(checkout,'fetch','--quiet','origin',AGENT_REACH_PIN.commit);}
 if(git(checkout,'rev-parse',`${AGENT_REACH_PIN.commit}:agent_reach`)!==AGENT_REACH_PIN.tree)throw new Error('Agent Reach source does not match the pinned tree');
 return checkout;
}

export function prepareAgentReachImage(){
 const architecture=runtimeArchitecture(),tag=`desvio-agent-reach:${architecture}`;
 const context=mkdtempSync(join(tmpdir(),'desvio-agent-reach-build-'));
 try{
  for(const relative of ['apps/agent-reach/Dockerfile','apps/agent-reach/requirements.lock','apps/agent-reach/runtime.py','apps/agent-reach/channels.py']){
   const target=join(context,relative);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,relative),target);
  }
  // Exactly the pinned commit's package and license, from git's object store.
  const source=join(context,'agent-reach-source');mkdirSync(source);
  const archive=execFileSync('git',['-C',agentReachCheckout(),'archive','--format=tar',AGENT_REACH_PIN.commit,'agent_reach','LICENSE'],{maxBuffer:64*1024*1024,timeout:60000});
  execFileSync('tar',['-x','-C',source],{input:archive,timeout:60000});
  execFileSync('docker',['build','--platform',`linux/${architecture}`,'--build-arg',`BASE_IMAGE=${pythonRuntimeImage(architecture)}`,'--build-arg',`NODE_IMAGE=${renderRuntimeImage(architecture)}`,
   '-q','-t',tag,'-f',join(context,'apps/agent-reach/Dockerfile'),context],{stdio:['ignore','pipe','pipe'],timeout:1800000});
  const image=execFileSync('docker',['image','inspect',tag,'--format','{{.Id}}'],{encoding:'utf8',timeout:10000}).trim();
  if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Agent Reach image digest missing');
  assertRuntimeArchitecture(image,architecture);
  return image;
 }finally{rmSync(context,{recursive:true,force:true});}
}

/** Offline checks (network none): non-root, read-only root, only web and YouTube channels, login
 * channels refused by the runner, and the CLI answers in its JSON envelope. */
export function verifyAgentReachImage(image){
 const sandbox=['run','--rm','-i','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=128m','--env','HOME=/tmp/home'];
 const user=execFileSync('docker',['image','inspect',image,'--format','{{.Config.User}}'],{encoding:'utf8'}).trim();
 if(user!=='65534:65534')throw new Error('Agent Reach image must run as 65534');
 const channels=JSON.parse(execFileSync('docker',[...sandbox,'--entrypoint','sh',image,'-c','mkdir -p /tmp/home && cd /tmp/home && python -m agent_reach.cli channels'],{encoding:'utf8',timeout:60000}));
 const names=channels.channels.map(c=>c.name).sort();
 if(JSON.stringify(names)!==JSON.stringify(['web','youtube']))throw new Error(`Unexpected channels ${names}`);
 const output=execFileSync('docker',[...sandbox,image],{encoding:'utf8',timeout:90000,input:[
  {id:1,channel:'reddit',action:'search',params:{query:'x'}},{id:2,channel:'youtube',action:'transcribe',params:{target:'https://www.youtube.com/watch?v=jNQXAC9IVRw'}},
  {id:3,channel:'web',action:'read',params:{target:'https://example.com/'},timeout:3},{type:'end'}].map(l=>JSON.stringify(l)).join('\n')+'\n'});
 const lines=output.trim().split('\n').map(l=>JSON.parse(l));
 const byId=Object.fromEntries(lines.filter(l=>l.type==='result').map(l=>[l.id,l.envelope]));
 if(lines[0].type!=='ready'||lines[0].version!=='agent-reach-runner-v1')throw new Error('Runner did not start');
 if(byId[1]?.error?.code!=='CHANNEL_NOT_ALLOWED'||byId[2]?.error?.code!=='CHANNEL_NOT_ALLOWED')throw new Error('Login or keyed channel was not refused');
 if(byId[3]?.schema_version!==1||byId[3].ok!==false||byId[3].channel!=='web')throw new Error('Offline read did not return an Agent Reach envelope');
 const writable=execFileSync('docker',[...sandbox,'--entrypoint','sh',image,'-c','touch /opt/x 2>/dev/null && echo writable || echo read-only; ls -A /tmp | wc -l'],{encoding:'utf8',timeout:30000}).trim().split('\n');
 if(writable[0]!=='read-only'||writable[1]!=='0')throw new Error('Root must be read-only and the home empty');
 return {channels:names,refused:['reddit search','youtube transcribe'],offlineRead:byId[3].error.code};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const image=prepareAgentReachImage();
 process.stdout.write(JSON.stringify({image,commit:AGENT_REACH_PIN.commit,checks:verifyAgentReachImage(image)})+'\n');
}
