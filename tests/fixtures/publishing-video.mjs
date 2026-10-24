// Browser fixture only: real isolated MP4 rendering/private storage and review
// services, with seeded provider output. This is not a live generation result.
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {VideoRenderer} from '../../dist/video-renderer.js';
import {VideoCanvas} from '../../dist/video-canvas.js';
import {VideoReferenceBindings} from '../../dist/video-references.js';
export async function publishingVideo({admin,store,canvas,exports,plans,alice,org,brand,fixture,render,image,staticImage,channel='linkedin'}){
 const source=await fixture({},'MOCK video reference'),exp=await render(source);
 await canvas.review(alice.id,brand.id,source.id,{decision:'in_review',feedback:'Video reference',revision:1});
 const approval=await exports.approve(alice.id,brand.id,exp.id,{sha256:exp.sha256,source_sha256:source.sha256,context_type:'canvas',context_id:source.id,context_revision:2,confirmed:true});
 const service=new VideoCanvas(canvas,new VideoReferenceBindings(canvas,staticImage),true),thread=(await admin.query('SELECT thread_id FROM app.creative_projects WHERE id=$1',[source.project_id])).rows[0].thread_id;
 const j=await service.submit(alice.id,brand.id,thread,{prompt:'MOCK browser fixture',channel,duration_seconds:3,reference:{export_id:exp.id,approval_id:approval.id,source_sha256:source.sha256,export_sha256:exp.sha256,confirmed:true}},randomUUID());
 const request=(await admin.query('SELECT * FROM app.video_requests WHERE job_id=$1',[j.id])).rows[0];
 const clip=Buffer.from(execFileSync('docker',['run','--rm','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--entrypoint','python',image,'-c',"import sys,base64; sys.path.insert(0,'/runtime'); import runtime as r; r.command('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=320x180:duration=3:rate=24','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','/tmp/test.mp4']); print(base64.b64encode(open('/tmp/test.mp4','rb').read()).decode())"],{encoding:'utf8',timeout:30000}).trim(),'base64');
 const out=await new VideoRenderer(image).render(clip,3),prefix=`video/${org.id}/${brand.id}/${j.id}`,sha=out.manifest.video_sha256,posterSHA=out.manifest.poster_sha256,id=randomUUID(),caption='MOCK browser '+channel+' video publication';
 for(const [key,bytes,mime,h] of [[`${prefix}/base/${sha}`,out.video,'video/mp4',sha],[`${prefix}/render/${sha}`,out.video,'video/mp4',sha],[`${prefix}/poster/${posterSHA}`,out.poster,'image/png',posterSHA]])await store.persist(key,bytes,mime,h);
 await admin.query('INSERT INTO app.video_bases(job_id,organization_id,brand_id,object_key,sha256,bytes,width,height,duration_ms,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[j.id,org.id,brand.id,`${prefix}/base/${sha}`,sha,out.video.length,out.metadata.width,out.metadata.height,out.metadata.duration_ms,JSON.stringify(out.manifest)]);
 await admin.query('INSERT INTO app.video_versions(id,organization_id,brand_id,project_id,job_id,object_key,sha256,bytes,poster_key,poster_sha256,poster_bytes,caption,overlays,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,org.id,brand.id,request.project_id,j.id,`${prefix}/render/${sha}`,sha,out.video.length,`${prefix}/poster/${posterSHA}`,posterSHA,out.poster.length,caption,'[]',JSON.stringify(out.manifest)]);
 await admin.query('UPDATE app.video_projects SET latest_version_id=$2 WHERE id=$1',[request.project_id,id]);await admin.query('UPDATE app.video_requests SET output_version_id=$2 WHERE job_id=$1',[j.id,id]);await admin.query("UPDATE app.jobs SET status='succeeded' WHERE id=$1",[j.id]);
 await service.review(alice.id,brand.id,id,{decision:'in_review',feedback:'Review fixture',revision:1,sha256:sha});await service.review(alice.id,brand.id,id,{decision:'approved',feedback:'Approve fixture',revision:2,sha256:sha,confirmed:true});
 const date=new Date(Date.now()+86400000).toISOString(),start=date.slice(0,10),plan=await plans.create(alice.id,brand.id,{title:'MOCK video publishing',objective:'Review exact media',starts_on:start,timezone:'UTC',slots:[{channel,format:'video',planned_at:date,brief:'MOCK fixture',video_version_id:id}]},randomUUID());
 let slot=(await plans.list(alice.id,brand.id,{start:start+'T00:00:00Z',end:new Date(Date.parse(start)+86400000).toISOString(),plan_id:plan.id})).slots[0];for(const decision of ['pending_review','approved'])slot=await plans.review(alice.id,brand.id,slot.id,{decision,revision:slot.revision,video_version_id:id,video_sha256:sha});
 return {v:{id,caption,sha256:sha},slot,bytes:out.video};
}
