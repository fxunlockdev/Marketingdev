import {prepareVideoImage} from './video-runtime-image.mjs';
import {execFileSync,spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const name=`desvio-video-test-${randomUUID()}`;
try {
 const image=prepareVideoImage();
 const args=['run','--rm','--name',name,'--label','desvio.purpose=video-test','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','2g','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=256m',
 '--mount',`type=bind,source=${join(root,'tests/runtime/video-media.py')},target=/test.py,readonly`,
 '-e','PYTHONDONTWRITEBYTECODE=1','--entrypoint','python',image,'/test.py'];
 console.log(`Actual pinned ARM64 FFmpeg rendering image ${image}; no runtime/dependency bind mounts, network or credentials. Synthetic clips only; not a cloud/provider quality test.`);
 const result=spawnSync('docker',args,{stdio:'inherit',timeout:240000,env:{PATH:process.env.PATH}});
 process.exitCode=result.status??1;
 if(process.exitCode===0){const adapter=spawnSync(process.execPath,['--test','tests/runtime/video-renderer.test.mjs'],{stdio:'inherit',timeout:240000,env:{...process.env,VIDEO_RENDER_IMAGE:image}});process.exitCode=adapter.status??1;}
} finally {
 try{execFileSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});}catch{}
}
