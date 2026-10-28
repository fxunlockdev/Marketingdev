import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
try{
 const state=JSON.parse(await readFile('work/railway-worker-host.json','utf8')),bundle=JSON.parse(await readFile('work/website-render-bundle/bundle.json','utf8'));
 const image=bundle.images?.[0]?.image_id;
 if(state.environment_id!==environment||!/^[-a-f0-9]{36}$/.test(state.id)||!/^[a-f0-9]{64}$/.test(bundle.sha256)||!/^sha256:[a-f0-9]{64}$/.test(image??'')||bundle.images.length!==1)throw new Error('VERIFY_SCOPE_INVALID');
 const code=`import sys,subprocess,hashlib\np='/opt/desvio/images/${bundle.sha256}.tar.gz'\nh=hashlib.sha256()\nwith open(p,'rb') as f:\n while True:\n  b=f.read(1048576)\n  if not b: break\n  h.update(b)\nassert h.hexdigest()=='${bundle.sha256}'\nsubprocess.run(['docker','load','-i',p],check=True,stdout=subprocess.DEVNULL)\nsys.argv=['verify-website-render-image.py','${image}']\nexec(compile(sys.stdin.read(),'verify-website-render-image.py','exec'))`;
 const output=execFileSync('railway',['sandbox','exec','--id',state.id,'--project',project,'--environment',environment,'--timeout','180','--','python3 -c '+quote(code)],{input:await readFile('scripts/verify-website-render-image.py','utf8'),encoding:'utf8',timeout:200000,maxBuffer:8192,env:{...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-website-acceptance-20261026'},stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(output);if(result.passed!==true||result.image!==image||result.architecture!=='amd64'||result.external_calls!==0||result.activated!==false)throw new Error('VERIFY_RESULT_INVALID');
 const report={checked_at:new Date().toISOString(),sandbox_id:state.id,environment_id:environment,...result,scope:'Native amd64 offline JS website fixture and isolated browser boundary; no worker activation or live owner website verification'};
 await writeFile('docs/evidence/railway-website-render-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(/^VERIFY_[A-Z_]+$/.test(e.message)?e.message:'VERIFY_NATIVE_FAILED');process.exitCode=1;}
