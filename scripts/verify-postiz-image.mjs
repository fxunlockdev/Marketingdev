// Offline image acceptance: never connects to a provider, database, or social account.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {POSTIZ_SOURCE} from './postiz-build-context.mjs';
const image=process.argv[2];
if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('POSTIZ_EXACT_IMAGE_REQUIRED');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
try{
 const [info]=JSON.parse(docker(['image','inspect',image]));
 if(info.Architecture!=='amd64'||info.Config.Labels?.['org.opencontainers.image.revision']!==POSTIZ_SOURCE)throw Error('identity');
 const run=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','node','--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--entrypoint','node',image];
 const probe=`const fs=require('node:fs');const assert=require('node:assert/strict');(async()=>{const bcrypt=require('bcrypt');assert(await bcrypt.compare('probe',await bcrypt.hash('probe',4)));const sharp=require('sharp');const png=await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();assert.equal((await sharp(png).metadata()).format,'png');assert.equal(require('@prisma/client').Prisma.prismaVersion.client,'6.5.0');for(const p of ['apps/backend/dist/apps/backend/src/main.js','apps/orchestrator/dist/apps/orchestrator/src/main.js'])assert(fs.statSync('/app/'+p).size>0);const source=JSON.parse(fs.readFileSync('/app/DESVIO_BUILD_SOURCE.json'));const runtime={};for(const name of ['nginx.conf','start.mjs','entrypoint.sh'])runtime[name]=require('node:crypto').createHash('sha256').update(fs.readFileSync('/opt/desvio-postiz/'+name)).digest('hex');console.log(JSON.stringify({source,runtime,bcrypt:true,sharp:true,prisma:true,entrypoints:true}));})().catch(()=>{console.error('IMAGE_PROBE_FAILED');process.exit(1)});`;
 const result=JSON.parse(docker([...run,'-e',probe]));
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 if(result.source.commit!==POSTIZ_SOURCE||result.source.upstream_application_source_modified!==false||result.source.dockerfile_sha256!==hash('infra/postiz/Dockerfile'))throw Error('source');
 for(const name of ['nginx.conf','start.mjs','entrypoint.sh'])if(result.runtime[name]!==hash('infra/postiz/runtime/'+name)||result.source.runtime_overlays[name]!==result.runtime[name])throw Error('overlay');
 docker([...run,'--check','/opt/desvio-postiz/start.mjs']);
 docker([...run.slice(0,-3),'--entrypoint','nginx',image,'-t','-c','/opt/desvio-postiz/nginx.conf']);
 const report={checked_at:new Date().toISOString(),image_id:image,source_commit:POSTIZ_SOURCE,architecture:info.Architecture,checks:result,nginx_configuration:true,supervisor_syntax:true,scope:'Actual immutable image/native module/entrypoint/configuration checks with network disabled. Does not prove database migration, backend/orchestrator readiness, OAuth, publication, or license clearance.'};
 writeFileSync('docs/evidence/postiz-image.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('POSTIZ_IMAGE_ACCEPTANCE_FAILED');process.exitCode=1;}
