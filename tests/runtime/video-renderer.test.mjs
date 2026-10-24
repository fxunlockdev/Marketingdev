import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {VideoRenderer,validateVideoOverlays,VIDEO_RENDER_VERSION} from '../../dist/video-renderer.js';
import {digest} from '../../dist/object-store.js';
const image=process.env.VIDEO_RENDER_IMAGE;
assert.match(image,/^sha256:[a-f0-9]{64}$/);
const source=Buffer.from(execFileSync('docker',['run','--rm','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--entrypoint','python',image,'-c',"import sys,base64; sys.path.insert(0,'/runtime'); import runtime as r; r.command('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=320x180:duration=3:rate=24','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','/tmp/test.mp4']); print(base64.b64encode(open('/tmp/test.mp4','rb').read()).decode())"],{encoding:'utf8',timeout:30000}).trim(),'base64');
const overlay={text:'Your next chapter',start_ms:0,end_ms:2000,position:'bottom',foreground:'#ffffff',background:'#111111'};
test('actual pinned video renderer returns validated clip/poster and exact overlay provenance without mounts',async()=>{
 const r=await new VideoRenderer(image).render(source,3,[overlay]);
 assert.equal(r.metadata.duration_ms,3000);assert.equal(r.manifest.version,VIDEO_RENDER_VERSION);assert.equal(r.manifest.input_sha256,digest(source));assert.equal(r.manifest.video_sha256,digest(r.video));assert.equal(r.manifest.poster_sha256,digest(r.poster));assert.equal(r.manifest.image,image);assert.deepEqual(r.manifest.overlays,[overlay]);
 const repeat=await new VideoRenderer(image).render(source,3,[overlay]);assert.equal(digest(repeat.video),digest(r.video));assert.equal(digest(repeat.poster),digest(r.poster));
 const r2=await new VideoRenderer(image).render(source,3,[]);assert.notEqual(digest(r.video),digest(r2.video));
});
test('adapter rejects invalid image pins, media and timeline fields and sanitizes native failures',async()=>{
 await assert.rejects(new VideoRenderer('latest').render(source,3),/NOT_CONFIGURED/);
 await assert.rejects(new VideoRenderer(image).render(Buffer.from('https://private.invalid'),3),/INPUT_INVALID/);
 assert.throws(()=>validateVideoOverlays([{...overlay,end_ms:4000}],3),/OVERLAY_INVALID/);
 assert.throws(()=>validateVideoOverlays([{...overlay,start_ms:NaN}],3),/OVERLAY_INVALID/);
 assert.throws(()=>validateVideoOverlays([overlay,overlay],3),/OVERLAY_INVALID/);
 await assert.rejects(new VideoRenderer(image).render(source.subarray(0,100),3),/VIDEO_MEDIA_/);
});
