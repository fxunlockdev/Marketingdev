import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const POSTIZ_SOURCE='651876e24317c2d8e717262cf98267ec6f699180';
const root=fileURLToPath(new URL('../',import.meta.url));
export function postizBuildContext(checkout){
 const git=(...args)=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(git('rev-parse','HEAD')!==POSTIZ_SOURCE||git('status','--porcelain'))throw Error('POSTIZ_EXACT_CLEAN_CHECKOUT_REQUIRED');
 const directory=mkdtempSync(join(tmpdir(),'desvio-postiz-source-'));
 const archive=execFileSync('git',['-C',checkout,'archive','--format=tar',POSTIZ_SOURCE],{maxBuffer:100*1024*1024,stdio:['ignore','pipe','pipe']});
 mkdirSync(join(directory,'upstream'));
 execFileSync('tar',['-xf','-','-C',join(directory,'upstream')],{input:archive,stdio:['pipe','ignore','pipe']});
 copyFileSync(join(root,'infra/postiz/Dockerfile'),join(directory,'Dockerfile'));
 mkdirSync(join(directory,'desvio-runtime'));
 const runtime={};
 for(const name of ['nginx.conf','start.mjs','entrypoint.sh']){const bytes=readFileSync(join(root,'infra/postiz/runtime',name));writeFileSync(join(directory,'desvio-runtime',name),bytes);runtime[name]=createHash('sha256').update(bytes).digest('hex');}
 writeFileSync(join(directory,'.dockerignore'),'.git\n.env\n.env.*\nnode_modules\n**/node_modules\n**/.next\n**/dist\n');
 const evidence={commit:POSTIZ_SOURCE,archive_sha256:createHash('sha256').update(archive).digest('hex'),dockerfile_sha256:createHash('sha256').update(readFileSync(join(directory,'Dockerfile'))).digest('hex'),runtime_overlays:runtime,upstream_application_source_modified:false,scope:'Exact upstream application source plus separate headless deployment/runtime overlays; no runtime equivalence or license clearance claim.'};
 writeFileSync(join(directory,'DESVIO_BUILD_SOURCE.json'),JSON.stringify(evidence,null,2)+'\n');
 return {directory,...evidence};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error();
  console.log(JSON.stringify(postizBuildContext(resolve(process.argv[2])),null,2));
 }catch{console.error('POSTIZ_BUILD_CONTEXT_FAILED');process.exitCode=1;}
}
