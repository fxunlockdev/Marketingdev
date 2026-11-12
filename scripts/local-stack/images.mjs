// Sandbox images the worker runs, built with the same helpers the test suites use.
// Each helper runs in its own process; its build output goes to logs/images.log.
import {spawn} from 'node:child_process';
import {createWriteStream,chmodSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT,PATHS} from './config.mjs';

const HELPERS={
 skill:['./scripts/skill-test-image.mjs','prepareSkillImage'],
 render:['./scripts/render-test-image.mjs','prepareRenderImage'],
 document:['./scripts/document-test-image.mjs','prepareDocumentImage'],
 video:['./scripts/video-runtime-image.mjs','prepareVideoImage'],
};

function run(args,log){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});
  let out='';
  child.stdout.on('data',b=>{out+=b;log.write(b);});
  child.stderr.on('data',b=>log.write(b));
  child.on('error',reject);
  child.on('exit',code=>code===0?resolve(out):reject(new Error(`exit ${code}`)));
 });
}
async function helperImage(name,log){
 const [module,fn]=HELPERS[name];
 const out=await run(['--input-type=module','-e',`const m=await import(${JSON.stringify(module)});process.stdout.write('\\nDIGEST:'+m.${fn}()+'\\n');`],log);
 const digest=out.match(/DIGEST:(sha256:[a-f0-9]{64})/)?.[1];
 if(!digest)throw new Error('no image digest');
 return digest;
}
async function websiteImage(log,architecture){
 await run(['scripts/build-website-renderer.mjs',`linux/${architecture}`],log);
 const out=await run(['--input-type=module','-e',`import {execFileSync} from 'node:child_process';process.stdout.write('DIGEST:'+execFileSync('docker',['image','inspect','desvio-website-render:${architecture}','--format','{{.Id}}'],{encoding:'utf8'}).trim());`],log);
 const digest=out.match(/DIGEST:(sha256:[a-f0-9]{64})/)?.[1];
 if(!digest)throw new Error('no image digest');
 return digest;
}

/** Builds (or reuses cached layers of) every sandbox image. Video is optional: it only
 * matters for video publishing, which needs Runway and is not part of the local run. */
export async function prepareImages({withVideo,architecture},report){
 const archive=join(ROOT,'inputs/desvio-production.zip');
 if(!existsSync(archive))throw new Error('inputs/desvio-production.zip is missing; the skill image cannot be built without it');
 // The sandbox build user must be able to read the private rules archive.
 chmodSync(archive,0o644);
 const log=createWriteStream(join(PATHS.logs,'images.log'),{flags:'a'});
 const names=['skill','render','document','website',...(withVideo?['video']:[])];
 const settled=await Promise.allSettled(names.map(async name=>{
  const started=Date.now();
  const digest=name==='website'?await websiteImage(log,architecture):await helperImage(name,log);
  report(`  image ${name.padEnd(8)} ${digest.slice(0,19)}… (${Math.round((Date.now()-started)/1000)}s)`);
  return [name,digest];
 }));
 log.end();
 const images={},failed=[];
 settled.forEach((r,i)=>r.status==='fulfilled'?images[r.value[0]]=r.value[1]:failed.push(names[i]));
 return {images,failed};
}
