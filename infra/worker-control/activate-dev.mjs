import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout} from 'node:timers/promises';
import {loadDevWorker,inspectDevWorker,startDevWorker} from './start-dev.mjs';
import {activationPlan,activate} from './activation.mjs';
const service='21260f12-2ad2-413c-9f67-2a1c4d6f8c83';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const env={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-coordinated-activation'};
const call=(args,input,timeout=30000)=>execFileSync('railway',args,{env,input,encoding:'utf8',timeout,maxBuffer:2000000,stdio:['pipe','pipe','pipe']});
export function activationIO(){
 let context,plan,trackedDeployment;
 const scope=()=>['--project',context.state.project_id,'--environment',context.state.environment_id,'--service',service];
 const remote=(code,input,seconds=30)=>call(['sandbox','exec','--id',context.state.id,'--project',context.state.project_id,'--environment',context.state.environment_id,'--timeout',String(seconds),'--','python3 -c '+quote(code)],JSON.stringify(input),(seconds+10)*1000);
 const status=()=>JSON.parse(call(['service','status',...scope(),'--json']));
 const variables=()=>JSON.parse(call(['variables',...scope(),'--json']));
 const guardDeployment=()=>{const observed=status();if(observed.deploymentId!==trackedDeployment)throw Error('ACTIVATION_API_DEPLOYMENT_CHANGED');return observed;};
 const lockPath='/opt/desvio/provider-activation-lock';
 const locked=`import sys,json,subprocess,os\nx=json.load(sys.stdin)\np='${lockPath}'\nassert open(p+'/token').read()==x['token']\n`;
 const io={
  async snapshot(){
   context=loadDevWorker();const api=status();
   const snapshot={spec:context.spec,observed:inspectDevWorker(context),api:{...api,variables:variables()}};
   // Never serialize snapshot: it contains private desired worker values.
   plan=activationPlan(snapshot);trackedDeployment=api.deploymentId;return snapshot;
  },
  async lock(token){remote(`import sys,json,os\nx=json.load(sys.stdin)\np='${lockPath}'\nos.mkdir(p,0o700)\nopen(p+'/token','w').write(x['token'])`,{token});},
  async unlock(token){remote(locked+`os.unlink(p+'/token')\nos.rmdir(p)`,{token});},
  async assertIdle(){
   const js=`import {Pool} from 'pg';let raw='';for await(const chunk of process.stdin)raw+=chunk;const db=new Pool({connectionString:JSON.parse(raw).url,connectionTimeoutMillis:10000});try{const r=await db.query("SELECT count(*)::int AS n FROM app.jobs WHERE status IN ('queued','running','retrying')");if(r.rows[0].n!==0)throw Error('BUSY');console.log('idle');}finally{await db.end();}`;
   remote(`import sys,json,subprocess\nx=json.load(sys.stdin)\nr=subprocess.run(['docker','run','--rm','-i','--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m',x['image'],'node','--input-type=module','-e',x['script']],input=json.dumps({'url':x['url']}),capture_output=True,text=True)\nassert r.returncode==0 and r.stdout.strip()=='idle'`,{url:context.adminURL,image:context.spec.image,script:js});
  },
  async journal(value){writeFileSync('work/provider-activation-journal.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});},
  async swapWorker(worker,backup,token){
   remote(locked+`name='desvio-trusted-worker'\ninfo=json.loads(subprocess.check_output(['docker','inspect',name]))[0]\nassert info['Id']==x['before']['id'] and info['Image']==x['before']['image'] and info['Config']['Labels'].get('desvio.configuration')==x['before']['configuration']\nassert info['Config']['Labels'].get('desvio.purpose')=='trusted-worker'\nassert not subprocess.check_output(['docker','ps','-aq','--filter','name=^/'+x['backup']+'$']).strip()\nsubprocess.run(['docker','stop','--time','120',name],check=True,capture_output=True)\nsubprocess.run(['docker','rename',name,x['backup']],check=True,capture_output=True)`,{token,backup,before:worker.before},150);
  },
  async startWorker(){startDevWorker(context);},
  async restoreWorker(worker,backup,token){
   remote(locked+`name='desvio-trusted-worker'\ndef info(n):\n ids=subprocess.check_output(['docker','ps','-aq','--filter','name=^/'+n+'$']).strip()\n return json.loads(subprocess.check_output(['docker','inspect',n]))[0] if ids else None\nold=info(x['backup']); current=info(name)\nif old:\n assert old['Id']==x['before']['id']\n if current:\n  assert current['Config']['Labels'].get('desvio.purpose')=='trusted-worker' and current['Image']==x['image'] and current['Config']['Labels'].get('desvio.configuration')==x['configuration']\n  subprocess.run(['docker','rm','-f',name],check=True,capture_output=True)\n subprocess.run(['docker','rename',x['backup'],name],check=True,capture_output=True)\nelse:\n assert current and current['Id']==x['before']['id']\nsubprocess.run(['docker','start',name],check=True,capture_output=True)`,{token,backup,...worker},60);
  },
  async verifyWorker(rollback=false){
   const expected=rollback?plan.worker.before:{image:plan.worker.image,configuration:plan.worker.configuration};
   let passed=false;
   for(let i=0;i<6;i++){
    try{
     const observed=inspectDevWorker(context).worker;
     if(!observed?.running||observed.image!==expected.image||observed.configuration!==expected.configuration)throw Error();
     execFileSync('node',['infra/worker-control/check-registration.mjs'],{env,encoding:'utf8',timeout:50000,stdio:['ignore','pipe','pipe']});passed=true;break;
    }catch{if(i<5)await setTimeout(5000);}
   }
   if(!passed)throw Error('ACTIVATION_WORKER_VERIFICATION_FAILED');
  },
  async setAPI(values){
   guardDeployment();
   const prior=variables();
   const keys=['VIDEO_ENABLED','VIDEO_RUNTIME_IMAGE','RENDER_RUNTIME_IMAGE'];
   if(keys.some(k=>!Object.hasOwn(values,k)))throw Error('ACTIVATION_API_CONFIGURATION_INVALID');
   if(keys.every(k=>(prior[k]??(k==='VIDEO_ENABLED'?'false':''))===values[k]))return;
   call(['variable','set',...keys.map(k=>k+'='+values[k]),...scope(),'--skip-deploys','--json']);
   const result=JSON.parse(call(['redeploy',...scope(),'--yes','--json']));
   const id=result.deploymentId??result.id;
   if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw Error('ACTIVATION_DEPLOYMENT_ID_UNCONFIRMED');
   const previous=trackedDeployment;trackedDeployment=id;
   for(let i=0;i<60;i++){
    const current=status();
    if(current.deploymentId===previous){await setTimeout(5000);continue;}
    if(current.deploymentId!==id)throw Error('ACTIVATION_API_DEPLOYMENT_CHANGED');
    if(current.status==='SUCCESS'&&!current.stopped)return;
    if(['FAILED','CRASHED','REMOVED','SKIPPED','NEEDS_APPROVAL'].includes(current.status))throw Error('ACTIVATION_API_DEPLOYMENT_FAILED');
    await setTimeout(5000);
   }
   throw Error('ACTIVATION_API_DEPLOYMENT_UNCONFIRMED');
  },
  async verifyAPI(values){
   const current=guardDeployment(),actual=variables();
   if(current.status!=='SUCCESS'||current.stopped||Object.keys(values).some(k=>(actual[k]??(k==='VIDEO_ENABLED'?'false':''))!==values[k]))throw Error('ACTIVATION_API_VERIFICATION_FAILED');
  },
 };
 return io;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--apply'&&/^[a-f0-9]{64}$/.test(args[1])))throw Error('ACTIVATION_USAGE');
  const io=activationIO(),plan=activationPlan(await io.snapshot());
  const result=args.length?await activate(plan,args[1],io):{status:'preview',...plan};
  const report={checked_at:new Date().toISOString(),...result,scope:'Dev runtime configuration only. Business spending grants, provider eligibility and live acceptance remain separate.'};
  writeFileSync('docs/evidence/railway-provider-activation.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }catch(e){console.error(/^ACTIVATION_[A-Z_]+$/.test(e.message)?e.message:'ACTIVATION_FAILED_RECONCILE');process.exitCode=1;}
}
