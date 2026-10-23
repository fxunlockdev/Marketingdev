import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {Publication} from '../../dist/publication.js';
import {PublicationJobs} from '../../dist/publication-jobs.js';
import {SocialConnections} from '../../dist/social-connections.js';
import {PostizVault} from '../../dist/postiz-vault.js';
import {digest} from '../../dist/object-store.js';
export async function proveVideoPublication({admin,jobs,store,businesses,exports,plans,org,brand,alice,bob,editor,video,image,staticImage}){
 const key=randomBytes(32).toString('hex'),credential='MOCK_'+randomBytes(24).toString('hex'),channel=randomUUID(),binding={organization_id:org.id,brand_id:brand.id,remote_organization_id:'mock-video-org',revision:1};
 await admin.query('INSERT INTO app.postiz_accounts(organization_id,brand_id,remote_organization_id,encrypted_credential,credential_fingerprint,enabled,identity_verified_at) VALUES($1,$2,$3,$4,$5,true,now())',[org.id,brand.id,binding.remote_organization_id,new PostizVault(key).seal(binding,credential),createHash('sha256').update(credential).digest('hex')]);
 const sync=randomUUID();await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'social.sync','succeeded')",[sync,org.id,brand.id,alice.id]);
 await admin.query("INSERT INTO app.social_channels(id,organization_id,brand_id,remote_id,provider,name,observed_state,last_seen_at,last_checked_at,account_revision,last_job_id) VALUES($1,$2,$3,'mock-video-channel','linkedin','MOCK video account','available',now(),now(),1,$4)",[channel,org.id,brand.id,sync]);
 await admin.query("INSERT INTO app.publication_grants VALUES($1,$2,$3,now()+interval '1 day',20,'LOCAL MOCK ONLY')",[org.id,brand.id,channel]);
 let base,uploads=0,submissions=0,rows=[],lost=false;const bytes=await store.read(video.object_key,64*1024*1024);
 const reply=(res,v)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(v));};
 const server=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);assert.equal(req.headers.authorization,credential);
  if(req.url==='/api/public/v1/me')return reply(res,{organization:{id:binding.remote_organization_id,name:'MOCK'}});
  if(req.url==='/api/public/v1/integrations')return reply(res,[{id:'mock-video-channel',identifier:'linkedin',disabled:false,name:'MOCK'}]);
  if(req.url==='/api/public/v1/upload'){uploads++;const marker=Buffer.from('Content-Type: video/mp4\r\n\r\n'),start=body.indexOf(marker);assert.ok(start>=0);assert.deepEqual(body.subarray(start+marker.length,body.lastIndexOf(Buffer.from('\r\n--'))),bytes);return reply(res,{id:'mock-video-media',path:base+'/media/video.mp4'});}
  if(req.url==='/api/public/v1/posts'){submissions++;const wire=JSON.parse(body);assert.equal(wire.posts[0].value[0].image[0].path,base+'/media/video.mp4');rows.push({id:'mock-video-post',integration:{id:'mock-video-channel',providerIdentifier:'linkedin'},content:wire.posts[0].value[0].content,publishDate:wire.date,state:'PUBLISHED',releaseId:'MOCK_VIDEO_RELEASE',releaseURL:null});if(lost){req.socket.destroy();return;}return reply(res,[{postId:'mock-video-post',integration:'mock-video-channel'}]);}
  if(req.url.startsWith('/api/public/v1/posts?'))return reply(res,{posts:rows});res.writeHead(404);res.end();
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const publication=new Publication(new SocialConnections(businesses,true),exports,true,image),worker=new PublicationJobs(jobs,{client:{baseURL:base+'/api',mediaOrigins:[base],callbackOrigin:'https://desvio.test',mode:'test'},encryptionKey:key},staticImage,true,image),scope=j=>({organizationId:org.id,brandId:brand.id,jobId:j.id});
 async function approvedSlot(){const date=new Date(Date.now()+86400000).toISOString(),start=date.slice(0,10);const plan=await plans.create(alice.id,brand.id,{title:'MOCK video publication',objective:'Verify video path',starts_on:start,timezone:'UTC',slots:[{channel:'linkedin',format:'video',planned_at:date,brief:'Approved canonical clip',video_version_id:video.id}]},randomUUID());let slot=(await plans.list(alice.id,brand.id,{start:new Date(Date.parse(start)).toISOString(),end:new Date(Date.parse(start)+86400000).toISOString(),plan_id:plan.id})).slots[0];for(const decision of ['pending_review','approved'])slot=await plans.review(alice.id,brand.id,slot.id,{decision,revision:slot.revision,video_version_id:video.id,video_sha256:video.sha256});return slot;}
 const body=s=>({slot_id:s.id,revision:s.revision,video_version_id:video.id,channel_id:channel,confirmed:true});
 try{
  const slot=await approvedSlot();await assert.rejects(new Publication(new SocialConnections(businesses,true),exports,true).submit(alice.id,brand.id,body(slot),randomUUID()),/not configured/);assert.ok((await publication.ready(alice.id,brand.id)).posts.some(p=>p.video_version_id===video.id));
  await assert.rejects(publication.submit(bob.id,brand.id,body(slot),randomUUID()));await assert.rejects(publication.submit(editor.id,brand.id,body(slot),randomUUID()));
  assert.throws(()=>publication.submit(alice.id,brand.id,{...body(slot),export_id:randomUUID()},randomUUID()));
  await admin.query("UPDATE app.video_versions SET status='changes_requested' WHERE id=$1",[video.id]);await assert.rejects(publication.submit(alice.id,brand.id,body(slot),randomUUID()),/Approve/);await admin.query("UPDATE app.video_versions SET status='approved' WHERE id=$1",[video.id]);
  const requestKey=randomUUID(),j=await publication.submit(alice.id,brand.id,body(slot),requestKey);assert.equal((await publication.submit(alice.id,brand.id,body(slot),requestKey)).id,j.id);
  assert.equal(await worker.run(scope(j)),'accepted');assert.equal(uploads,1);assert.equal(submissions,1);assert.equal((await worker.reconcile(scope(j))).state,'published');assert.equal(await worker.run(scope(j)),'accepted');assert.equal(submissions,1);
  const record=(await publication.list(alice.id,brand.id)).publications.find(r=>r.id===j.id);assert.equal(record.video_sha256,digest(bytes));assert.equal(record.image_sha256,null);assert.equal(record.release_id,'MOCK_VIDEO_RELEASE');assert.ok(!JSON.stringify(record).includes('object_key'));
  const stale=await approvedSlot(),staleJob=await publication.submit(alice.id,brand.id,body(stale),randomUUID());await plans.edit(alice.id,brand.id,stale.id,{revision:stale.revision,brief:'Changed after publication consent',reset_approval:true});assert.equal(await worker.run(scope(staleJob)),'rejected');assert.equal(uploads,1);
  const unknown=await approvedSlot(),unknownJob=await publication.submit(alice.id,brand.id,body(unknown),randomUUID());lost=true;await worker.run(scope(unknownJob));assert.equal((await admin.query('SELECT phase FROM app.publication_requests WHERE job_id=$1',[unknownJob.id])).rows[0].phase,'unknown');await worker.run(scope(unknownJob));assert.equal(submissions,2);await assert.rejects(publication.submit(alice.id,brand.id,body(unknown),randomUUID()),/already/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
