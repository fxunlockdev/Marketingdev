import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {PostizClient,PostizError} from '../../dist/postiz-client.js';
let server,base,handler,requests=[];
const keyA='TEST_ONLY_POSTIZ_ORG_A_KEY',keyB='TEST_ONLY_POSTIZ_ORG_B_KEY';
const binding=(key=keyA,remoteOrganizationId='org-a')=>({organizationId:randomUUID(),brandId:randomUUID(),remoteOrganizationId,apiKey:key});
const config=()=>({baseURL:base+'/api',mediaOrigins:[base],callbackOrigin:'https://desvio.test',mode:'test'});
const json=(res,value,status=200,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));};
const integration={id:'channel-a',name:'MOCK LinkedIn',identifier:'linkedin',disabled:false,profile:'https://www.linkedin.com/in/mock',picture:null};
const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#eee'}}).png().toBuffer(),hash=createHash('sha256').update(png).digest('hex');
before(async()=>{server=createServer(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);const body=Buffer.concat(chunks);requests.push({path:req.url,method:req.method,headers:req.headers,body});if(req.url==='/api/public/v1/me')return json(res,{organization:{id:req.headers.authorization===keyA?'org-a':'org-b',name:'MOCK organization'},user:null});await handler(req,res,body);});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
const client=()=>new PostizClient(config(),binding());

test('Postiz verifies remote organization before every operation; no org override or credential leakage',async()=>{
 requests=[];handler=(req,res)=>json(res,[{...integration,token:'SECRET_FROM_UPSTREAM',refreshToken:'SECRET_REFRESH'}]);
 const channels=await client().listIntegrations();assert.equal(channels[0].id,'channel-a');assert.equal(channels[0].provider,'linkedin');assert.ok(!JSON.stringify(channels).includes('SECRET'));
 assert.deepEqual(requests.map(r=>r.path),['/api/public/v1/me','/api/public/v1/integrations']);assert.ok(requests.every(r=>r.headers.authorization===keyA&&!r.headers['x-postiz-org']&&!r.headers.cookie));
 requests=[];await assert.rejects(new PostizClient(config(),binding(keyB)).listIntegrations(),e=>e.code==='POSTIZ_TENANT_MISMATCH');assert.equal(requests.length,1);
 assert.ok(!JSON.stringify(client()).includes(keyA));
});
test('OAuth allows only the audited provider origin, path, state and exact Desvio callback',async()=>{
 let url='https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=MOCK&state=abcdef123&redirect_uri='+encodeURIComponent('https://desvio.test/integrations/social/linkedin');handler=(req,res)=>json(res,{url});
 assert.equal((await client().beginLinkedIn()).state,'abcdef123');
 for(const invalid of [url.replace('www.linkedin.com','evil.test'),url+'&state=another',url.replace('desvio.test','evil.test'),url.replace('/oauth/v2/authorization','/other'),url.replace('state=abcdef123','state=x')]){const prior=url;url=invalid;await assert.rejects(client().beginLinkedIn(),e=>e.code==='POSTIZ_RESPONSE_INVALID'&&e.outcome==='unknown');url=prior;}
});
test('OAuth callback filters credentials and binds the returned account to its actual organization/provider',async()=>{
 let response={id:'channel-a',organizationId:'org-a',providerIdentifier:'linkedin',internalId:'member-a',name:'MOCK member',pages:[],token:'NEVER_RETURN',refreshToken:'NEVER_RETURN',customInstanceDetails:'NEVER_RETURN'};
 handler=(req,res,body)=>{assert.equal(req.url,'/api/integrations/social-connect/linkedin');assert.deepEqual(JSON.parse(body),{state:'abcdef123',code:'TEST_CODE',timezone:'-480'});json(res,response);};
 assert.deepEqual(await client().completeLinkedIn('abcdef123','TEST_CODE','-480'),{id:'channel-a',internalId:'member-a',name:'MOCK member'});
 response={...response,organizationId:'org-b'};await assert.rejects(client().completeLinkedIn('abcdef123','TEST_CODE','-480'),e=>e.code==='POSTIZ_RESPONSE_INVALID'&&e.outcome==='unknown');
 await assert.rejects(client().completeLinkedIn('bad','CODE','-480'),e=>e.outcome==='not_sent');
});
test('uploads send actual hash-checked PNG bytes as multipart and do not enable Postiz image adjustment',async()=>{
 requests=[];handler=(req,res,body)=>{assert.equal(req.url,'/api/public/v1/upload');assert.match(req.headers['content-type'],/^multipart\/form-data; boundary=/);assert.ok(body.includes(png));assert.match(body.toString('latin1'),/name="adjust"\r\n\r\nfalse/);json(res,{id:'media-a',path:base+'/uploads/'+hash+'.png',token:'UPSTREAM_SECRET'});};
 assert.deepEqual(await client().uploadPNG(png,hash),{id:'media-a',path:base+'/uploads/'+hash+'.png'});
 const count=requests.length;await assert.rejects(client().uploadPNG(png,'0'.repeat(64)),e=>e.outcome==='not_sent');assert.equal(requests.length,count);
 handler=(req,res)=>json(res,{id:'media-a',path:'https://evil.test/file.png'});await assert.rejects(client().uploadPNG(png,hash),e=>e.code==='POSTIZ_RESPONSE_INVALID'&&e.outcome==='unknown');
});
test('schedule sends one exact channel-specific request; response is acceptance, never publication',async()=>{
 requests=[];handler=(req,res,body)=>{if(req.url.endsWith('/integrations'))return json(res,[integration]);assert.equal(req.url,'/api/public/v1/posts');assert.deepEqual(JSON.parse(body),{type:'schedule',date:'2026-11-01T10:00:00.000Z',shortLink:false,tags:[],posts:[{integration:{id:'channel-a'},value:[{content:'MOCK approved caption',image:[{id:'media-a',path:base+'/uploads/final.png'}]}],settings:{__type:'linkedin',post_as_images_carousel:false}}]});json(res,[{postId:'post-a',integration:'channel-a'}]);};
 const input={integrationId:'channel-a',caption:'MOCK approved caption',media:{id:'media-a',path:base+'/uploads/final.png'},scheduledAt:'2026-11-01T10:00:00Z'};
 assert.deepEqual(await client().submitLinkedIn(input),{postId:'post-a',integrationId:'channel-a',status:'accepted'});
 assert.equal(requests.filter(r=>r.method==='POST').length,1);assert.ok(requests.every(r=>!r.headers['idempotency-key']));
 requests=[];await assert.rejects(client().submitLinkedIn({...input,integrationId:'foreign-channel'}),e=>e.code==='POSTIZ_CHANNEL_UNAVAILABLE');assert.equal(requests.filter(r=>r.method==='POST').length,0);
 handler=(req,res)=>json(res,[{...integration,disabled:true}]);await assert.rejects(client().submitLinkedIn(input),e=>e.code==='POSTIZ_CHANNEL_UNAVAILABLE');
});
test('ambiguous scheduling never retries and never leaks provider response secrets',async()=>{
 const input={integrationId:'channel-a',caption:'MOCK',media:{id:'media-a',path:base+'/uploads/final.png'},scheduledAt:'2026-11-01T10:00:00Z'};
 for(const kind of ['disconnect','500','malformed','foreign-id']){
  requests=[];handler=(req,res)=>{if(req.url.endsWith('/integrations'))return json(res,[integration]);if(kind==='disconnect')return req.socket.destroy();if(kind==='500')return json(res,{secret:keyA},500);if(kind==='foreign-id')return json(res,[{postId:'post-a',integration:'foreign-channel'}]);res.writeHead(200,{'content-type':'application/json'});res.end('secret '+keyA);};
  await assert.rejects(client().submitLinkedIn(input),e=>e instanceof PostizError&&e.outcome==='unknown'&&!JSON.stringify(e).includes(keyA)&&!e.message.includes(keyA));assert.equal(requests.filter(r=>r.method==='POST').length,1);
 }
});
test('authorization/rate-limit responses are explicit, bounded and not automatically retried',async()=>{
 for(const status of [401,403,429]){requests=[];handler=(req,res)=>json(res,{msg:keyA},status,{'retry-after':'99999'});await assert.rejects(client().listIntegrations(),e=>e.outcome==='rejected'&&e.retryAfterSeconds===3600&&!e.message.includes(keyA));assert.equal(requests.length,2);}
});
test('reconciliation uses date-bounded list and observed release identity; missing or unfamiliar status is unknown',async()=>{
 handler=(req,res)=>{const u=new URL(req.url,base);assert.equal(u.pathname,'/api/public/v1/posts');assert.equal(u.searchParams.get('startDate'),'2026-11-01T00:00:00.000Z');assert.ok(u.searchParams.has('endDate'));json(res,{posts:['QUEUE','PUBLISHED','ERROR','DRAFT','FUTURE_STATE','PUBLISHED'].map((state,i)=>({id:'post-'+i,content:'MOCK',publishDate:'2026-11-01T10:00:00Z',state,releaseId:i===1?'provider-post':null,releaseURL:i===1?'https://www.linkedin.com/feed/update/mock':null,error:'NEVER_RETURN',integration:{id:'channel-a',providerIdentifier:'linkedin'}}))});};
 const posts=await client().listPosts('2026-11-01T00:00:00Z','2026-11-30T23:59:59Z');assert.deepEqual(posts.map(p=>p.state),['queued','published','failed','draft','unknown','unknown']);assert.ok(!JSON.stringify(posts).includes('NEVER_RETURN'));
 await assert.rejects(client().listPosts('2026-01-01T00:00:00Z','2026-12-31T00:00:00Z'),e=>e.code==='POSTIZ_DATE_RANGE_INVALID');
});
test('redirects, oversized JSON, broken schemas and timeout fail closed',async()=>{
 handler=(req,res)=>{res.writeHead(302,{location:'https://evil.test/steal'});res.end();};await assert.rejects(client().listIntegrations(),e=>e.code==='POSTIZ_NETWORK_ERROR');
 handler=(req,res)=>json(res,{oversized:'x'.repeat(2*1024*1024)});await assert.rejects(client().listIntegrations(),e=>e.code==='POSTIZ_RESPONSE_INVALID');
 handler=(req,res)=>json(res,[{...integration,disabled:'false'}]);await assert.rejects(client().listIntegrations(),e=>e.code==='POSTIZ_RESPONSE_INVALID');
 handler=()=>{};await assert.rejects(new PostizClient({...config(),timeoutMs:30},binding()).listIntegrations(),e=>e.code==='POSTIZ_TIMEOUT');
});
test('unsafe endpoint and callback configurations are rejected before any network call',()=>{
 for(const patch of [{baseURL:'http://evil.test/api'},{baseURL:'https://user:password@example.test/api'},{baseURL:'https://example.test/api?secret=x'},{baseURL:'https://example.test/not-api'},{callbackOrigin:'https://desvio.test/path'},{mediaOrigins:['javascript:alert(1)']}])assert.throws(()=>new PostizClient({...config(),...patch},binding()),/POSTIZ_CONFIG_INVALID/);
});


test('canonical MP4 upload uses the pinned multipart contract and video-specific scheduling without accepting image paths',async()=>{
 const mp4=Buffer.alloc(32);mp4.writeUInt32BE(32);mp4.write('ftypisom',4);const sha=createHash('sha256').update(mp4).digest('hex');let uploaded=0,scheduled=0;
 handler=(req,res,body)=>{if(req.url==='/api/public/v1/upload'){uploaded++;assert.ok(body.includes(Buffer.from('video/mp4')));assert.ok(body.includes(Buffer.from(`desvio-${sha}.mp4`)));assert.ok(body.includes(Buffer.from('false')));return json(res,{id:'video-a',path:base+'/media/canonical.mp4'});}if(req.url==='/api/public/v1/integrations')return json(res,[integration]);if(req.url==='/api/public/v1/posts'){scheduled++;const value=JSON.parse(body);assert.deepEqual(value.posts[0].value[0].image,[{id:'video-a',path:base+'/media/canonical.mp4'}]);assert.equal(value.posts[0].settings.post_as_images_carousel,false);return json(res,[{postId:'video-post',integration:'channel-a'}]);}return json(res,{},404);};
 const c=client(),media=await c.uploadMP4(mp4,sha);assert.equal(uploaded,1);
 await assert.rejects(c.submitLinkedIn({integrationId:'channel-a',caption:'MOCK video',media,scheduledAt:'2026-12-01T00:00:00Z'}),e=>e.code==='POSTIZ_POST_INVALID');
 assert.equal((await c.submitLinkedIn({integrationId:'channel-a',caption:'MOCK video',media,mediaType:'video',scheduledAt:'2026-12-01T00:00:00Z'})).status,'accepted');assert.equal(scheduled,1);
 await assert.rejects(c.uploadMP4(png,hash),e=>e.code==='POSTIZ_MEDIA_INVALID');await assert.rejects(c.uploadMP4(mp4,'0'.repeat(64)),e=>e.code==='POSTIZ_MEDIA_INVALID');assert.equal(uploaded,1);
 handler=(req,res)=>json(res,{id:'wrong-kind',path:base+'/media/wrong.png'});await assert.rejects(c.uploadMP4(mp4,sha),e=>e.code==='POSTIZ_RESPONSE_INVALID'&&e.outcome==='unknown');
});

test('post analytics verifies identity, preserves unknown data and rejects malformed numeric series',async()=>{
 requests=[];handler=(req,res)=>{assert.equal(req.url,'/api/public/v1/analytics/post/post-a?date=30');json(res,[{label:'Impressions',data:[{date:'2026-10-23',total:'120'},{date:'2026-10-22',total:100}],percentageChange:999,token:'SECRET'}]);};
 assert.deepEqual(await client().postAnalytics('post-a'),{state:'available',series:[{label:'Impressions',points:[{date:'2026-10-22',value:100},{date:'2026-10-23',value:120}]}]});
 assert.deepEqual(requests.map(r=>r.path),['/api/public/v1/me','/api/public/v1/analytics/post/post-a?date=30']);
 for(const value of [[],[{label:'Likes',data:[]}]]){handler=(req,res)=>json(res,value);assert.deepEqual(await client().postAnalytics('post-a'),{state:'unavailable',series:[]});}
 handler=(req,res)=>json(res,{missing:true});assert.equal((await client().postAnalytics('post-a')).state,'missing');
 for(const value of [[{label:'Likes',data:[{date:'2026-02-30',total:2}]}],[{label:'Likes',data:[{date:'2026-10-23',total:''}]}],[{label:'Likes',data:[{date:'2026-10-23',total:-1}]}],[{label:'Likes',data:[{date:'2026-10-23',total:1},{date:'2026-10-23',total:2}]}],[{label:'Likes',data:[]},{label:'likes',data:[]}],{missing:false}]){handler=(req,res)=>json(res,value);await assert.rejects(client().postAnalytics('post-a'),e=>e.code==='POSTIZ_ANALYTICS_INVALID');}
 requests=[];await assert.rejects(new PostizClient(config(),binding(keyB)).postAnalytics('post-a'),e=>e.code==='POSTIZ_TENANT_MISMATCH');assert.equal(requests.length,1);
 await assert.rejects(client().postAnalytics('../other'),e=>e.code==='POSTIZ_RESPONSE_INVALID');await assert.rejects(client().postAnalytics('post-a',91),e=>e.code==='POSTIZ_DATE_RANGE_INVALID');
});

test('ordered carousel submits exactly one native LinkedIn multi-image post',async()=>{
 const media=[{id:'slide-2',path:base+'/uploads/second.png'},{id:'slide-1',path:base+'/uploads/first.png'}];
 const input={integrationId:'channel-a',caption:'Approved ordered carousel',media,mediaType:'carousel',scheduledAt:'2026-11-01T10:00:00Z'};
 requests=[];handler=(req,res,body)=>{if(req.url.endsWith('/integrations'))return json(res,[integration]);assert.equal(req.url,'/api/public/v1/posts');const v=JSON.parse(body);assert.equal(v.posts.length,1);assert.deepEqual(v.posts[0].value,[{content:input.caption,image:media}]);assert.equal(v.posts[0].settings.post_as_images_carousel,false);return json(res,[{postId:'carousel-a',integration:'channel-a'}]);};
 assert.deepEqual(await client().submitLinkedIn(input),{postId:'carousel-a',integrationId:'channel-a',status:'accepted'});
 assert.equal(requests.filter(r=>r.method==='POST').length,1);
 for(const patch of [{media:[]},{media:[media[0]]},{media:Array.from({length:11},(_,i)=>({id:'slide-'+i,path:base+'/uploads/'+i+'.png'}))},{media:[media[0],media[0]]},{media:[media[0],{...media[1],id:media[0].id}]},{media:[media[0],{...media[1],path:media[0].path}]},{media:[media[0],{...media[1],path:'https://foreign.test/a.png'}]},{media:[media[0],{...media[1],path:base+'/uploads/video.mp4'}]},{mediaType:'video'},{mediaType:undefined}]){
  requests=[];await assert.rejects(client().submitLinkedIn({...input,...patch}),e=>e.code==='POSTIZ_POST_INVALID'&&e.outcome==='not_sent');assert.equal(requests.length,0);
 }
 requests=[];handler=(req,res)=>{if(req.url.endsWith('/integrations'))return json(res,[integration]);req.socket.destroy();};
 await assert.rejects(client().submitLinkedIn(input),e=>e.outcome==='unknown');assert.equal(requests.filter(r=>r.method==='POST').length,1);
 requests=[];await assert.rejects(new PostizClient(config(),binding(keyB)).submitLinkedIn(input),e=>e.code==='POSTIZ_TENANT_MISMATCH');assert.equal(requests.filter(r=>r.method==='POST').length,0);
});

test('scheduled removal validates exact queued target and returns unconfirmed stopping, never canceled',async()=>{
 const scheduledAt=new Date(Date.now()+86400000).toISOString(),input={postId:'post-a',integrationId:'channel-a',scheduledAt,caption:'Approved caption'};
 const post={id:input.postId,content:input.caption,publishDate:scheduledAt,state:'QUEUE',releaseId:null,releaseURL:null,integration:{id:'channel-a',providerIdentifier:'linkedin'}};
 requests=[];handler=(req,res)=>req.method==='DELETE'?json(res,{id:'post-a'}):json(res,{posts:[post]});
 assert.deepEqual(await client().requestScheduledPostRemoval(input),{postId:'post-a',status:'removal_requested',publishingStopped:false});assert.equal(requests.filter(r=>r.method==='DELETE').length,1);assert.equal(requests.at(-1).path,'/api/public/v1/posts/post-a');
 for(const patch of [{state:'PUBLISHED',releaseId:'live'},{integration:{id:'foreign',providerIdentifier:'linkedin'}},{content:'Changed caption'},{releaseURL:'https://linkedin.com/live'}]){
  requests=[];handler=(req,res)=>json(res,{posts:[{...post,...patch}]});await assert.rejects(client().requestScheduledPostRemoval(input),e=>e.code==='POSTIZ_REMOVAL_TARGET_UNCONFIRMED');assert.equal(requests.filter(r=>r.method==='DELETE').length,0);
 }
 requests=[];await assert.rejects(client().requestScheduledPostRemoval({...input,scheduledAt:new Date().toISOString()}),e=>e.code==='POSTIZ_REMOVAL_INPUT_INVALID');assert.equal(requests.length,0);
});
test('ambiguous removal is never retried and a mismatched acknowledgment stays unknown',async()=>{
 const scheduledAt=new Date(Date.now()+86400000).toISOString(),input={postId:'post-a',integrationId:'channel-a',scheduledAt,caption:'Approved'};
 for(const mode of ['network','500','wrong-id','error']){
  requests=[];handler=(req,res)=>{if(req.method!=='DELETE')return json(res,{posts:[{id:'post-a',content:'Approved',publishDate:scheduledAt,state:'QUEUE',releaseId:null,releaseURL:null,integration:{id:'channel-a',providerIdentifier:'linkedin'}}]});if(mode==='network')return req.socket.destroy();if(mode==='500')return json(res,{secret:keyA},500);json(res,mode==='error'?{error:true}:{id:'foreign'});};
  await assert.rejects(client().requestScheduledPostRemoval(input),e=>e.outcome==='unknown'&&!e.message.includes(keyA));assert.equal(requests.filter(r=>r.method==='DELETE').length,1);
 }
 requests=[];await assert.rejects(new PostizClient(config(),binding(keyB)).requestScheduledPostRemoval(input),e=>e.code==='POSTIZ_TENANT_MISMATCH');assert.equal(requests.filter(r=>r.method==='DELETE').length,0);
});
