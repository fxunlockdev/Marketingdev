import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const base='python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1';
const cache=process.env.DESVIO_VIDEO_DEB_CACHE??join(root,'work/video-deps-arm64/debs');
const work=mkdtempSync(join(root,'work/video-media-test-')),bundle=join(work,'bundle'),name=`desvio-video-test-${randomUUID()}`;
try {
 execFileSync('python3',[join(root,'scripts/prepare-video-bundle.py'),cache,bundle],{stdio:'inherit',timeout:120000});
 const args=['run','--rm','--name',name,'--label','desvio.purpose=video-test','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','2g','--cpus','1','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=256m',
 '--mount',`type=bind,source=${bundle},target=/opt/video-deps,readonly`,
 '--mount',`type=bind,source=${join(root,'apps/video')},target=/runtime,readonly`,
 '--mount',`type=bind,source=${join(root,'tests/runtime/video-media.py')},target=/test.py,readonly`,
 '-e','PYTHONDONTWRITEBYTECODE=1','--entrypoint','python',base,'/test.py'];
 console.log('Actual ARM64 FFmpeg 7.1.5 test in pinned Python container; signed-archive pins checked, dependencies/runtime mounted read-only. This is not a built/deployed video runtime image or provider quality test.');
 const result=spawnSync('docker',args,{stdio:'inherit',timeout:240000,env:{PATH:process.env.PATH}});
 process.exitCode=result.status??1;
} finally {
 try{execFileSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});}catch{}
 rmSync(work,{recursive:true,force:true});
}
