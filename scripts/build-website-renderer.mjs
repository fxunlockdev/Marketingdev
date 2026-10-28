import {renderRuntimeImage,assertRuntimeArchitecture} from './runtime-architecture.mjs';
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
// Exact allowlisted context also works with the legacy Docker builder, which
// does not implement per-Dockerfile .dockerignore files.
const platform=process.argv[2]??'linux/amd64';
if(!['linux/amd64','linux/arm64'].includes(platform))throw new Error('UNSUPPORTED_PLATFORM');
const context=await mkdtemp(join(tmpdir(),'desvio-website-build-'));
try{
 const directory=join(context,'apps/website-renderer');await mkdir(directory,{recursive:true});
 for(const name of ['package.json','package-lock.json','runtime.mjs','Dockerfile'])await copyFile(resolve('apps/website-renderer',name),join(directory,name));
 await new Promise((res,rej)=>{const child=spawn('docker',['build','--platform',platform,'--build-arg',`BASE_IMAGE=${renderRuntimeImage(platform.split('/')[1])}`,'-f',join(directory,'Dockerfile'),'-t',`desvio-website-render:${platform.split('/')[1]}`,context],{stdio:'inherit'});child.on('error',rej);child.on('close',code=>code===0?res():rej(new Error('WEBSITE_RENDER_IMAGE_BUILD_FAILED')));});
 assertRuntimeArchitecture(`desvio-website-render:${platform.split('/')[1]}`,platform.split('/')[1]);
}finally{await rm(context,{recursive:true,force:true});}
