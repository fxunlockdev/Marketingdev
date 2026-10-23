// Export only reviewed, credential-free local image IDs for the dedicated host.
import {spawn,execFileSync} from 'node:child_process';
import {readFile,mkdir,rename,writeFile,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const directory='work/worker-bundle';await mkdir(directory,{recursive:true});
const temporary=directory+'/'+randomUUID()+'.partial';let child;
try{
 const manifest=JSON.parse(await readFile('docs/evidence/worker-image-inventory.json','utf8'));
 const expected=['trusted_worker','documents','skills','static_renderer','video_renderer'];
 if(manifest.images.length!==5||new Set(manifest.images.map(i=>i.role)).size!==5||manifest.images.some(i=>!expected.includes(i.role)||!/^sha256:[a-f0-9]{64}$/.test(i.image_id)))throw new Error('BUNDLE_INVALID_INVENTORY');
 for(const entry of manifest.images){const info=JSON.parse(execFileSync('docker',['image','inspect',entry.image_id],{encoding:'utf8',timeout:10000}))[0];if(info.Architecture!=='amd64'||info.Os!=='linux'||!['node','65534:65534'].includes(info.Config.User))throw new Error('BUNDLE_IMAGE_BOUNDARY_MISMATCH');}
 const hash=createHash('sha256');const tap=new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback(null,chunk);}});
 child=spawn('docker',['save',...manifest.images.map(i=>i.image_id)],{stdio:['ignore','pipe','pipe']});
 const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error('BUNDLE_EXPORT_FAILED')));});
 child.stderr.resume();
 await Promise.all([completed,pipeline(child.stdout,createGzip({level:1}),tap,createWriteStream(temporary,{flags:'wx',mode:0o600}))]);
 const sha256=hash.digest('hex'),archive=`${directory}/${sha256}.tar.gz`;await rename(temporary,archive);
 const result={created_at:new Date().toISOString(),archive,sha256,bytes:(await stat(archive)).size,images:manifest.images,scope:'Credential-free Docker image archive, not a hosted worker readiness claim'};
 await writeFile(directory+'/bundle.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({sha256,bytes:result.bytes,images:result.images.length}));
}catch(e){child?.kill('SIGTERM');await rm(temporary,{force:true});console.error(/^BUNDLE_/.test(e.message)?e.message:'BUNDLE_EXPORT_FAILED');process.exitCode=1;}
