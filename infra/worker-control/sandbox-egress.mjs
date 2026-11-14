// Host firewall for the Agent Reach research sandbox.
// Agent Reach is the only sandbox that runs on Docker's default bridge (docker0); it reads
// untrusted public web pages, so it must never reach the environment's private network
// (Postgres, Temporal, API, scanner on *.railway.internal), cloud metadata or the host itself.
// The rules live in their own nftables table so Docker's own tables are never edited.
// A drop in any base chain is final, so this table wins over Docker's accept rules.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const EGRESS_TABLE='desvio_sandbox_egress';
export const SANDBOX_BRIDGE='docker0';
// Railway's resolver. Containers inherit it from the host; names still resolve, but every
// private address they resolve to is dropped below.
export const RAILWAY_RESOLVER='fd12::10';
export const PRIVATE_V4=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.168.0.0/16','198.18.0.0/15','224.0.0.0/3'];
export const PRIVATE_V6=['::/127','::ffff:0:0/96','64:ff9b::/96','fc00::/7','fe80::/10','ff00::/8'];

export function egressRuleset(){
 const i=`iifname "${SANDBOX_BRIDGE}"`;
 return [
  // Declaring then deleting makes a re-apply replace the table atomically instead of failing.
  `table inet ${EGRESS_TABLE}`,
  `delete table inet ${EGRESS_TABLE}`,
  `table inet ${EGRESS_TABLE} {`,
  ` set private4 { type ipv4_addr; flags interval; elements = { ${PRIVATE_V4.join(', ')} } }`,
  ` set private6 { type ipv6_addr; flags interval; elements = { ${PRIVATE_V6.join(', ')} } }`,
  ' chain forward {',
  '  type filter hook forward priority filter - 10; policy accept;',
  `  ${i} ct state established,related accept`,
  `  ${i} ip6 daddr ${RAILWAY_RESOLVER} meta l4proto { tcp, udp } th dport 53 accept`,
  `  ${i} ip daddr @private4 counter drop`,
  `  ${i} ip6 daddr @private6 counter drop`,
  `  ${i} meta l4proto tcp th dport { 80, 443 } accept`,
  `  ${i} meta l4proto udp th dport 443 accept`,
  `  ${i} counter drop`,
  ' }',
  ' chain input {',
  '  type filter hook input priority filter - 10; policy accept;',
  `  ${i} ct state established,related accept`,
  // IPv6 neighbour discovery with the bridge gateway; without it the container has no IPv6 at all (DNS included).
  `  ${i} icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit } accept`,
  `  ${i} counter drop`,
  ' }',
  '}',
  ''
 ].join('\n');
}

// Python run on the host: syntax-check, apply, then confirm the table is live.
export const applyProgram=`import sys,subprocess,json
rules=sys.stdin.read()
check=subprocess.run(['nft','-c','-f','-'],input=rules,capture_output=True,text=True)
if check.returncode: print(json.dumps({'applied':False,'stage':'check','error':check.stderr[-400:]}));sys.exit(1)
apply=subprocess.run(['nft','-f','-'],input=rules,capture_output=True,text=True)
if apply.returncode: print(json.dumps({'applied':False,'stage':'apply','error':apply.stderr[-400:]}));sys.exit(1)
live=subprocess.run(['nft','list','table','inet','${EGRESS_TABLE}'],capture_output=True,text=True)
print(json.dumps({'applied':live.returncode==0,'table':'${EGRESS_TABLE}'}))
sys.exit(0 if live.returncode==0 else 1)`;

export const checkProgram=`import subprocess,json
live=subprocess.run(['nft','list','table','inet','${EGRESS_TABLE}'],capture_output=True,text=True)
text=live.stdout
print(json.dumps({'present':live.returncode==0,'forward_drop':'@private4 counter' in text and '@private6 counter' in text,'input_drop':'hook input' in text}))`;

const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const cliEnv={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-sandbox-egress'};
const hostExec=(state,program,input,seconds=30)=>execFileSync('railway',['sandbox','exec','--id',state.id,'--project',state.project_id,'--environment',state.environment_id,'--timeout',String(seconds),'--','python3 -c '+quote(program)],{input,env:cliEnv,encoding:'utf8',timeout:(seconds+10)*1000,stdio:['pipe','pipe','pipe']});

export function applySandboxEgress(state,exec=hostExec){
 let out;
 try{out=exec(state,applyProgram,egressRuleset());}catch(e){out=e.stdout;}
 let result;try{result=JSON.parse(String(out||'').trim().split('\n').pop());}catch{result=null;}
 if(!result||result.applied!==true)throw Error('WORKER_EGRESS_FIREWALL_FAILED');
 return result;
}

export function checkSandboxEgress(state,exec=hostExec){
 const result=JSON.parse(String(exec(state,checkProgram,'')).trim().split('\n').pop());
 return {...result,ok:result.present===true&&result.forward_drop===true&&result.input_drop===true};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {readFileSync}=await import('node:fs');
 const {workerEnvironment}=await import('./environment.mjs');
 try{
  const args=process.argv.slice(2);
  if(args.some(a=>a!=='--check'))throw Error('WORKER_USAGE');
  const target=workerEnvironment(),state=JSON.parse(readFileSync(target.statePath));
  if(state.project_id!==target.project||state.environment_id!==target.environment)throw Error('WORKER_ENVIRONMENT_MISMATCH');
  const report=args.includes('--check')?checkSandboxEgress(state):applySandboxEgress(state);
  console.log(JSON.stringify({checked_at:new Date().toISOString(),sandbox_id:state.id,...report}));
  if(report.ok===false)process.exitCode=1;
 }catch(e){console.error(/^WORKER_[A-Z_]+$/.test(e.message)?e.message:'WORKER_EGRESS_FIREWALL_FAILED');process.exitCode=1;}
}
