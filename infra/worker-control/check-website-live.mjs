import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
try{
 const state=JSON.parse(await readFile('work/railway-worker-host.json','utf8')),inventory=JSON.parse(await readFile('docs/evidence/worker-image-inventory.json','utf8'));
 const worker=inventory.images.find(x=>x.role==='trusted_worker')?.image_id,image=process.argv.includes('--local-adapter')?JSON.parse(await readFile('work/website-render-bundle/bundle.json','utf8')).images.find(x=>x.role==='website_renderer')?.image_id:inventory.images.find(x=>x.role==='website_renderer')?.image_id;
 if(state.project_id!==project||state.environment_id!==environment||!/^[-a-f0-9]{36}$/.test(state.id)||![worker,image].every(x=>/^sha256:[a-f0-9]{64}$/.test(x??'')))throw Error('PROBE_SCOPE_INVALID');
 let source=await readFile('infra/worker-control/website-live-probe.mjs','utf8');
 if(process.argv.includes('--local-adapter')){
  const adapter=(await readFile('dist/website-renderer.js','utf8')).replaceAll("from './","from 'file:///opt/desvio/dist/").replace("from 'sharp'","from 'file:///opt/desvio/node_modules/sharp/dist/index.cjs'");
  source=source.replace("import {WebsiteRenderer} from '/opt/desvio/dist/website-renderer.js';","const {WebsiteRenderer}=await import("+JSON.stringify('data:text/javascript;base64,'+Buffer.from(adapter).toString('base64'))+");");
 }
 const code=`import sys,json,subprocess,os\nx=json.load(sys.stdin)\nc=json.loads(subprocess.check_output(['docker','inspect','desvio-trusted-worker']))[0]\nassert c['State']['Running'] and c['Image']==x['worker']\nassert x['local_adapter'] or ('WEBSITE_RENDER_IMAGE='+x['image']) in c['Config']['Env']\nargs=['docker','run','--rm','-i','--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','512m','--cpus','1','--group-add',str(os.stat('/var/run/docker.sock').st_gid),'--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',x['worker'],'node','--input-type=module','-e',x['source']]\np=subprocess.run(args,input=json.dumps({'url':'https://runwalrealty.com/','image':x['image']}),text=True,capture_output=True,timeout=65)\nprint(p.stdout,end='')\nif not p.stdout: print(p.stderr[-1600:],file=sys.stderr); sys.exit(1)`;
 const output=execFileSync('railway',['sandbox','exec','--id',state.id,'--project',project,'--environment',environment,'--timeout','90','--','python3 -c '+quote(code)],{input:JSON.stringify({worker,image,source,local_adapter:process.argv.includes('--local-adapter')}),encoding:'utf8',timeout:100000,maxBuffer:12*1024*1024,env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-website-public-probe'},stdio:['pipe','pipe','pipe']});
 const report=JSON.parse(output);if(report.url!=='https://runwalrealty.com/'||report.image!==image||report.paid_calls!==0||report.database_mutations!==0)throw Error('PROBE_REPORT_INVALID');
 await mkdir('work/website-live-preview',{recursive:true});
 for(const [i,asset] of (report.assets??[]).entries()){
  const bytes=Buffer.from(asset.base64,'base64');if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('PROBE_ASSET_HASH_INVALID');
  asset.path=`work/website-live-preview/${i}-${asset.kind}.jpg`;await writeFile(asset.path,bytes,{mode:0o600});delete asset.base64;
 }
 report.local_adapter=process.argv.includes('--local-adapter');report.checked_at=new Date().toISOString();report.scope='Public website capture only; no paid AI, database mutation or tenant intake completion';
 await writeFile(process.argv.includes('--local-adapter')?'docs/evidence/railway-website-local-adapter-live.json':'docs/evidence/railway-website-live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,text_sample:undefined,assets:report.assets?.map(a=>({kind:a.kind,path:a.path,width:a.width,height:a.height}))}));if(!report.passed)process.exitCode=1;
}catch(e){if(process.argv.includes('--local-adapter')){const diagnostic=String(e.stderr??'');console.error({operator_failure:diagnostic.match(/Error \[([A-Z_]+)\]/)?.[1]??'REMOTE_EXEC_FAILED',missing_module:diagnostic.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/)?.[1]??null});}console.error(/^PROBE_[A-Z_]+$/.test(e.message)?e.message:'PROBE_FAILED_NO_PAID_CALLS');process.exitCode=1;}
