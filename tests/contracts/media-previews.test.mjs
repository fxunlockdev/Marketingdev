import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import {Module,NotFoundException} from '@nestjs/common';
import {PREVIEW_WIDTHS,PREVIEW_CACHE_CONTROL,previewWidth,previewKey,previewEtag,etagMatches,mediaPreviewPath,mediaSrcSet,pickPreviewWidth,postCoverSource} from '../../dist/media-variants.js';
import {ImagePreviews,renderPreview} from '../../dist/image-previews.js';
import {s3PreviewPersistence} from '../../dist/media-storage.js';
import {MediaLibrary} from '../../dist/media-library.js';
import {createMediaController} from '../../dist/media-controller.js';

const hash=b=>createHash('sha256').update(b).digest('hex');
const org='11111111-1111-4111-8111-111111111111',brand='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',row='44444444-4444-4444-8444-444444444444';
// Noise keeps the fixture from compressing to nothing, so size assertions mean something.
const noise=Buffer.alloc(1024*1536*3);for(let i=0;i<noise.length;i++)noise[i]=(i*2654435761>>>13)&255;
const portrait=await sharp(noise,{raw:{width:1024,height:1536,channels:3}}).blur(6).png().toBuffer();
const portraitHash=hash(portrait),portraitKey=`creative/${org}/${brand}/${row}/${portraitHash}`;
const memoryStore=()=>{const objects=new Map();return {objects,reads:0,writes:0,async read(key){this.reads++;return objects.get(key)??null;},async write(key,bytes){this.writes++;objects.set(key,bytes);}};};

test('three fixed widths; requests snap up and reject anything that is not a plain positive integer',()=>{
 assert.deepEqual([...PREVIEW_WIDTHS],[320,640,1280]);
 assert.equal(previewWidth(undefined),640);
 for(const [asked,served] of [['1',320],['320',320],['321',640],['640',640],['641',1280],['1280',1280],['4096',1280]])assert.equal(previewWidth(asked),served,asked);
 for(const bad of ['','0','-1','1.5','1e3','abc','4097',' 640',['640','320'],640,null,{}])assert.throws(()=>previewWidth(bad),RangeError,JSON.stringify(bad));
});

test('storage keys are tenant-bound, content-addressed and versioned; foreign or malformed keys are refused',()=>{
 assert.equal(previewKey(portraitKey,portraitHash,640,{organizationId:org,brandId:brand}),`previews/v1/${portraitKey}/w640.webp`);
 assert.notEqual(previewKey(portraitKey,portraitHash,320,{organizationId:org,brandId:brand}),previewKey(portraitKey,portraitHash,640,{organizationId:org,brandId:brand}));
 assert.throws(()=>previewKey(portraitKey,portraitHash,640,{organizationId:other,brandId:brand}),/tenant/i);
 assert.throws(()=>previewKey(portraitKey,portraitHash,640,{organizationId:org,brandId:other}),/tenant/i);
 assert.throws(()=>previewKey(portraitKey,'0'.repeat(64),640,{organizationId:org,brandId:brand}),/content/i);
 assert.throws(()=>previewKey(`creative/${org}/${brand}/../${portraitHash}`,portraitHash,640,{organizationId:org,brandId:brand}),/key/i);
 assert.throws(()=>previewKey(portraitKey,portraitHash,500,{organizationId:org,brandId:brand}),RangeError);
});

test('ETags are strong, derive from source hash and width, and match conditional requests',()=>{
 const etag=previewEtag(portraitHash,640);
 assert.equal(etag,`"v1-${portraitHash}-w640"`);assert.notEqual(etag,previewEtag(portraitHash,320));
 assert.equal(etagMatches(etag,etag),true);assert.equal(etagMatches(`"x", ${etag}`,etag),true);assert.equal(etagMatches('W/'+etag,etag),true);assert.equal(etagMatches('*',etag),true);
 assert.equal(etagMatches(undefined,etag),false);assert.equal(etagMatches('',etag),false);assert.equal(etagMatches(previewEtag(portraitHash,320),etag),false);
 assert.equal(PREVIEW_CACHE_CONTROL,'private, max-age=31536000, immutable');
});

test('web helpers build one stable URL per variant and never request more pixels than the slot needs',()=>{
 const root=`/api/v1/businesses/${brand}`;
 assert.equal(mediaPreviewPath(brand,{kind:'creative',id:row},320),`${root}/creative-media/${row}/preview?w=320`);
 assert.equal(mediaPreviewPath(brand,{kind:'export',id:row},640),`${root}/creative-exports/${row}/preview?w=640`);
 assert.equal(mediaPreviewPath(brand,{kind:'poster',id:row},1280),`${root}/video-versions/${row}/poster/preview?w=1280`);
 assert.equal(mediaPreviewPath(brand,{kind:'cover',id:row},640),`${root}/carousel-versions/${row}/cover?w=640`);
 assert.throws(()=>mediaPreviewPath(brand,{kind:'creative',id:'../x'},320),/ID/);
 assert.equal(mediaSrcSet(brand,{kind:'creative',id:row}),[320,640,1280].map(w=>`${root}/creative-media/${row}/preview?w=${w} ${w}w`).join(', '));
 // A 1024-wide original is never advertised as wider than it is.
 assert.equal(mediaSrcSet(brand,{kind:'creative',id:row},1024),[`${root}/creative-media/${row}/preview?w=320 320w`,`${root}/creative-media/${row}/preview?w=640 640w`,`${root}/creative-media/${row}/preview?w=1280 1024w`].join(', '));
 assert.equal(pickPreviewWidth(64,1),320);assert.equal(pickPreviewWidth(64,3),320);assert.equal(pickPreviewWidth(300,2),640);assert.equal(pickPreviewWidth(420,2),1280);assert.equal(pickPreviewWidth(2000,3),1280);assert.equal(pickPreviewWidth(0,NaN),640);
});

test('a post maps to exactly one cover source without any lookup request',()=>{
 assert.deepEqual(postCoverSource({export_id:row,carousel_version_id:other,project_id:org}),{kind:'export',id:row});
 assert.deepEqual(postCoverSource({slides:[{export_id:row}]}),{kind:'export',id:row});
 assert.deepEqual(postCoverSource({video_version_id:row}),{kind:'poster',id:row});
 assert.deepEqual(postCoverSource({carousel_version_id:row,project_id:org}),{kind:'cover',id:row});
 assert.deepEqual(postCoverSource({design:{background_media_id:row,width:1024,height:1536}}),{kind:'creative',id:row});
 assert.equal(postCoverSource({format:'static'}),null);
});

test('variants are WebP at the requested pixel width, keep aspect and are far smaller than the original',async()=>{
 const sizes={};
 for(const width of PREVIEW_WIDTHS){
  const bytes=await renderPreview(portrait,width),meta=await sharp(bytes).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width,Math.min(width,1024));assert.equal(meta.height,Math.round(Math.min(width,1024)*1.5));sizes[width]=bytes.length;
 }
 assert.ok(sizes[320]<sizes[640]&&sizes[640]<sizes[1280],JSON.stringify(sizes));
 assert.ok(sizes[1280]<portrait.length/4,`1280 preview ${sizes[1280]} vs original ${portrait.length}`);
 assert.ok(sizes[320]<portrait.length/40,`320 preview ${sizes[320]} vs original ${portrait.length}`);
});

test('previews are generated once, persisted, and served from storage by a fresh process without reading the original',async()=>{
 const storage=memoryStore();let originals=0;
 const first=new ImagePreviews(async()=>{originals++;return portrait;});first.persistTo(storage);
 const made=await first.get(portraitKey,portraitHash,320);
 assert.equal(originals,1);assert.equal(storage.writes,1);assert.deepEqual([...storage.objects.keys()],[`previews/v1/${portraitKey}/w320.webp`]);
 assert.deepEqual(first.stats,{memory:0,storage:0,generated:1,persistFailures:0});
 await first.get(portraitKey,portraitHash,320);assert.equal(first.stats.memory,1);assert.equal(originals,1);
 // A restarted or second API instance has an empty memory cache.
 const second=new ImagePreviews(async()=>{originals++;return portrait;});second.persistTo(storage);
 const served=await second.get(portraitKey,portraitHash,320);
 assert.equal(originals,1,'the original is not read again');assert.equal(storage.writes,1);assert.equal(served.sha256,made.sha256);assert.deepEqual(second.stats,{memory:0,storage:1,generated:0,persistFailures:0});
 // Widths are separate objects.
 await second.get(portraitKey,portraitHash,1280);assert.equal(originals,2);assert.equal(storage.objects.size,2);
});

test('a failing or corrupt preview store never fails the request and never serves bad bytes',async()=>{
 const failures=[];let originals=0;
 const broken=new ImagePreviews(async()=>{originals++;return portrait;});
 broken.persistTo({async read(){throw new Error('storage down');},async write(){throw new Error('storage down');}},error=>failures.push(error.message));
 const value=await broken.get(portraitKey,portraitHash,640);
 assert.equal((await sharp(value.bytes).metadata()).format,'webp');assert.equal(broken.stats.persistFailures,2);assert.deepEqual(failures,['storage down','storage down']);
 const storage=memoryStore();storage.objects.set(`previews/v1/${portraitKey}/w640.webp`,Buffer.from('<html>not an image</html>'));
 const repaired=new ImagePreviews(async()=>{originals++;return portrait;});repaired.persistTo(storage);
 const healed=await repaired.get(portraitKey,portraitHash,640);
 assert.equal((await sharp(healed.bytes).metadata()).format,'webp');assert.equal(repaired.stats.generated,1);assert.equal((await sharp(storage.objects.get(`previews/v1/${portraitKey}/w640.webp`)).metadata()).format,'webp','the corrupt object is replaced');
 // Keys that are not tenant-bound content addresses still work, in memory only.
 const legacy=new ImagePreviews(async()=>portrait);const untouched=memoryStore();legacy.persistTo(untouched);
 await legacy.get('org/brand/image',portraitHash);assert.equal(untouched.reads+untouched.writes,0);
 await assert.rejects(legacy.get(portraitKey,portraitHash,500),RangeError);
});

test('the worker can pre-generate every width at creation time from bytes it already holds',async()=>{
 const storage=memoryStore();let originals=0;
 const worker=new ImagePreviews(async()=>{originals++;return portrait;});worker.persistTo(storage);
 const written=await worker.pregenerate(portraitKey,portraitHash,portrait);
 assert.deepEqual(written,[320,640,1280]);assert.equal(originals,0);assert.equal(storage.objects.size,3);
 assert.deepEqual(await worker.pregenerate(portraitKey,portraitHash,portrait),[],'already stored: nothing to do');assert.equal(storage.writes,3);
 await assert.rejects(worker.pregenerate(portraitKey,portraitHash,Buffer.from('other bytes')),/integrity/);
 const api=new ImagePreviews(async()=>{originals++;return portrait;});api.persistTo(storage);
 for(const width of PREVIEW_WIDTHS)await api.get(portraitKey,portraitHash,width);
 assert.equal(originals,0,'the API never touches the original for pre-generated media');assert.equal(api.stats.storage,3);
});

test('S3 persistence only touches the previews prefix, treats a missing object as absent and bounds reads',async()=>{
 const sent=[];const body=bytes=>({async *[Symbol.asyncIterator](){yield bytes;},destroy(){}});
 const client={send:async command=>{sent.push(command);
  if(command.constructor.name==='PutObjectCommand')return {};
  if(command.input.Key.endsWith('missing.webp'))throw Object.assign(new Error('NoSuchKey'),{$metadata:{httpStatusCode:404}});
  if(command.input.Key.endsWith('huge.webp'))return {ContentLength:2*1024*1024,Body:body(Buffer.alloc(8))};
  return {ContentLength:3,Body:body(Buffer.from([1,2,3]))};}};
 const persistence=s3PreviewPersistence(client,'bucket');
 assert.deepEqual([...(await persistence.read('previews/v1/a/w320.webp'))],[1,2,3]);
 assert.equal(await persistence.read('previews/v1/a/missing.webp'),null);
 await assert.rejects(persistence.read('previews/v1/a/huge.webp'),/size/i);
 await persistence.write('previews/v1/a/w320.webp',Buffer.from([9]));
 const put=sent.at(-1).input;assert.equal(put.Bucket,'bucket');assert.equal(put.Key,'previews/v1/a/w320.webp');assert.equal(put.ContentType,'image/webp');assert.equal(put.ContentLength,1);
 const before=sent.length;
 await assert.rejects(persistence.read(`creative/${org}/${brand}/x`),/prefix/i);await assert.rejects(persistence.write(`creative/${org}/${brand}/x`,Buffer.from([1])),/prefix/i);
 assert.equal(sent.length,before,'originals can never be read or overwritten through this adapter');
});

const scoped=({rows,authorized=()=>true,calls})=>({store:{previews:calls.previews},scope:async(user,id,write,action)=>{calls.scopes.push({user,id,write});if(!authorized())throw new NotFoundException('Business not found');return action({query:async(sql,params)=>{calls.queries.push({sql,params});return {rows:rows(sql,params)};}},{organization_id:org});}});
test('every preview request is authorized and tenant-scoped before the cache, storage or a 304 is considered',async()=>{
 const storage=memoryStore();const previews=new ImagePreviews(async()=>portrait);previews.persistTo(storage);
 let allowed=true;const calls={scopes:[],queries:[],previews};
 const library=new MediaLibrary(scoped({calls,authorized:()=>allowed,rows:(_sql,params)=>params[2]===row?[{object_key:portraitKey,sha256:portraitHash}]:[]}));
 const first=await library.preview('user',brand,{kind:'creative',id:row},'320',undefined);
 assert.equal(first.status,200);assert.equal(first.etag,previewEtag(portraitHash,320));assert.equal((await sharp(first.bytes).metadata()).width,320);
 assert.deepEqual(calls.scopes.at(-1),{user:'user',id:brand,write:false});assert.deepEqual(calls.queries.at(-1).params,[org,brand,row]);
 // Conditional request: authorized, then answered without touching storage or the original.
 const reads=storage.reads,generated=previews.stats.generated,memory=previews.stats.memory;
 const again=await library.preview('user',brand,{kind:'creative',id:row},'320',first.etag);
 assert.deepEqual(again,{status:304,etag:first.etag});assert.equal(calls.scopes.length,2);assert.equal(storage.reads,reads);assert.equal(previews.stats.generated,generated);assert.equal(previews.stats.memory,memory);
 // Access removed: neither the warm cache nor a matching ETag leaks anything.
 allowed=false;
 await assert.rejects(library.preview('user',brand,{kind:'creative',id:row},'320',first.etag),NotFoundException);
 await assert.rejects(library.preview('user',brand,{kind:'creative',id:row},'320',undefined),NotFoundException);
 allowed=true;
 await assert.rejects(library.preview('user',brand,{kind:'creative',id:other},'320',undefined),NotFoundException);
 await assert.rejects(library.preview('user',brand,{kind:'creative',id:'not-a-uuid'},'320',undefined),/Invalid resource ID/);
 await assert.rejects(library.preview('user',brand,{kind:'creative',id:row},'banana',undefined),/width/i);
 await assert.rejects(library.preview('user',brand,{kind:'unknown',id:row},'320',undefined),/Unknown media/);
});

test('a row whose object belongs to another tenant is refused even when the database returned it',async()=>{
 const calls={scopes:[],queries:[],previews:new ImagePreviews(async()=>portrait)};
 const foreign=`creative/${other}/${brand}/${row}/${portraitHash}`;
 const library=new MediaLibrary(scoped({calls,rows:()=>[{object_key:foreign,sha256:portraitHash}]}));
 await assert.rejects(library.preview('user',brand,{kind:'creative',id:row},'320',undefined),NotFoundException);
});

test('exports, video posters and carousel covers resolve in one scoped query each',async()=>{
 const calls={scopes:[],queries:[],previews:new ImagePreviews(async()=>portrait)};
 const library=new MediaLibrary(scoped({calls,rows:()=>[{object_key:portraitKey,sha256:portraitHash}]}));
 for(const [kind,table] of [['export','app.creative_exports'],['poster','app.video_versions'],['cover','app.carousel_pages']]){
  const before=calls.queries.length;
  const reply=await library.preview('user',brand,{kind,id:row},undefined,undefined);
  assert.equal(reply.status,200);assert.equal(reply.etag,previewEtag(portraitHash,640));assert.equal(calls.queries.length,before+1,kind);
  const {sql,params}=calls.queries.at(-1);assert.ok(sql.includes(table),kind);assert.ok(/organization_id=\$1/.test(sql)&&/brand_id=\$2/.test(sql),`${kind} is filtered by tenant, not only by row-level security`);assert.deepEqual(params,[org,brand,row]);
 }
 assert.ok(calls.queries.at(-1).sql.includes('position=0'),'the cover is the first slide');
});

test('HTTP: immutable private caching and 304s on success, never on errors; previous route paths keep working',async t=>{
 const guard=class{canActivate(context){const request=context.switchToHttp().getRequest();if(request.headers['x-test-user']){request.actorId=request.headers['x-test-user'];return true;}return false;}};
 const seen=[];
 const library={preview:async(user,business,source,width,ifNoneMatch)=>{seen.push({user,business,source,width,ifNoneMatch});
  if(source.id===other)throw new NotFoundException('Creative image not found');
  const etag=previewEtag(portraitHash,previewWidth(width));
  return etagMatches(ifNoneMatch,etag)?{status:304,etag}:{status:200,etag,bytes:Buffer.from([1,2,3,4])};}};
 const Controller=createMediaController(guard);
 class TestModule{}
 Module({controllers:[Controller],providers:[guard,{provide:MediaLibrary,useValue:library}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});
 // Mirrors the API's global default: nothing is cacheable unless a route says so.
 app.use((_request,response,next)=>{response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');next();});
 await app.listen(0,'127.0.0.1');t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/businesses/${brand}`,headers={'x-test-user':'user-1'};
 const ok=await fetch(`${base}/creative-media/${row}/preview?w=320`,{headers});
 assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'private, max-age=31536000, immutable');assert.equal(ok.headers.get('etag'),previewEtag(portraitHash,320));
 assert.equal(ok.headers.get('content-type'),'image/webp');assert.equal(ok.headers.get('content-length'),'4');assert.equal(ok.headers.get('x-content-type-options'),'nosniff');assert.equal(ok.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(ok.headers.get('content-disposition'),'inline');
 assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())],[1,2,3,4]);
 assert.deepEqual(seen.at(-1),{user:'user-1',business:brand,source:{kind:'creative',id:row},width:'320',ifNoneMatch:undefined});
 const cached=await fetch(`${base}/creative-media/${row}/preview?w=320`,{headers:{...headers,'if-none-match':ok.headers.get('etag')}});
 assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);assert.equal(cached.headers.get('cache-control'),'private, max-age=31536000, immutable');assert.equal(cached.headers.get('etag'),ok.headers.get('etag'));
 // Without ?w the existing callers still get the 640 preview they get today.
 const legacy=await fetch(`${base}/creative-exports/${row}/preview`,{headers});assert.equal(legacy.status,200);assert.equal(legacy.headers.get('etag'),previewEtag(portraitHash,640));assert.deepEqual(seen.at(-1).source,{kind:'export',id:row});
 for(const [path,kind] of [[`video-versions/${row}/poster/preview?w=640`,'poster'],[`carousel-versions/${row}/cover?w=1280`,'cover']]){const response=await fetch(`${base}/${path}`,{headers});assert.equal(response.status,200,path);assert.equal(seen.at(-1).source.kind,kind);await response.arrayBuffer();}
 const missing=await fetch(`${base}/creative-media/${other}/preview?w=320`,{headers});
 assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');assert.notEqual(missing.headers.get('etag'),previewEtag(portraitHash,320));await missing.arrayBuffer();
 const anonymous=await fetch(`${base}/creative-media/${row}/preview?w=320`);
 assert.equal(anonymous.status,403);assert.equal(anonymous.headers.get('cache-control'),'no-store');await anonymous.arrayBuffer();
 const calls=seen.length;const invalid=await fetch(`${base}/creative-media/${row}/preview?w=320&w=640`,{headers});
 assert.equal(invalid.status,400);assert.equal(invalid.headers.get('cache-control'),'no-store');assert.equal(seen.length,calls,'a malformed width is rejected before any lookup');await invalid.arrayBuffer();
});

test('producers pre-generate after persisting an original; a failure is logged and never thrown',async()=>{
 const {pregeneratePreviews}=await import('../../dist/preview-pregeneration.js');
 const storage=memoryStore(),previews=new ImagePreviews(async()=>portrait);previews.persistTo(storage);
 const lines=[];
 assert.deepEqual(await pregeneratePreviews(previews,{jobId:row,organizationId:org,brandId:brand},portraitKey,portraitHash,portrait,line=>lines.push(line)),[320,640,1280]);
 assert.equal(storage.objects.size,3);assert.deepEqual(lines,[]);
 // Wrong bytes for the hash: nothing stored, one redacted diagnostic line, no exception.
 assert.deepEqual(await pregeneratePreviews(previews,{jobId:row},`creative/${org}/${brand}/${row}/${'0'.repeat(64)}`,'0'.repeat(64),portrait,line=>lines.push(line)),[]);
 assert.equal(lines.length,1);const entry=JSON.parse(lines[0]);
 assert.equal(entry.activity,'PreviewPregeneration');assert.equal(entry.job_id??entry.jobId,row);
 // Storage down: still no exception.
 const down=new ImagePreviews(async()=>portrait);down.persistTo({async read(){return null;},async write(){throw new Error('storage down');}});
 assert.deepEqual(await pregeneratePreviews(down,{jobId:row},portraitKey,portraitHash,portrait,line=>lines.push(line)),[]);
 assert.equal(lines.length,2);
});
