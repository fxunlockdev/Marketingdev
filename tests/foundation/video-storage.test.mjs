// Real private S3-compatible storage. Byte fixtures test storage/replay, not media
// decoding, tenant authorization, provider output or customer feature completion.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {ObjectStore,digest,MAX_UPLOAD_BYTES,MAX_CANONICAL_VIDEO_BYTES} from '../../dist/object-store.js';
const config=JSON.parse(process.env.DESVIO_TEST_CONFIG);
const store=new ObjectStore(config.storage);
after(()=>store.close());
const key=bytes=>`video-storage-fixture/${randomUUID()}/${digest(bytes)}`;
const large=Buffer.alloc(MAX_UPLOAD_BYTES+1,0x41),sha=digest(large);

test('canonical video larger than upload limit persists once and verifies replay through actual private storage',async()=>{
 const path=key(large);
 await store.persist(path,large,'video/mp4',sha);
 assert.equal(await store.persist(path,large,'video/mp4',sha),'existing-verified');
 assert.equal(digest(await store.read(path,MAX_CANONICAL_VIDEO_BYTES)),sha);
 await assert.rejects(store.read(path),/FILE_TOO_LARGE/);
 const unsigned=new URL(`${config.storage.endpoint}/${config.storage.bucket}/${path}`);
 assert.equal((await fetch(unsigned)).status,403);
 const object=await store.client.send(new GetObjectCommand({Bucket:config.storage.bucket,Key:path}));
 assert.equal(object.ContentLength,large.length);assert.equal(object.ContentType,'video/mp4');assert.equal(object.Metadata.sha256,sha);object.Body.destroy();
});
test('concurrent video persistence and new worker instances recover the same content without replacing it',async()=>{
 const path=key(large),second=new ObjectStore(config.storage);
 try{
  const results=await Promise.all([store.persist(path,large,'video/mp4',sha),second.persist(path,large,'video/mp4',sha)]);
  assert.equal(results.length,2);
  assert.equal(await second.persist(path,large,'video/mp4',sha),'existing-verified');
  assert.equal(digest(await second.read(path,MAX_CANONICAL_VIDEO_BYTES)),sha);
 }finally{second.close();}
});
test('a lost acknowledgement after actual object persistence is safely recovered by hash-checked replay',async()=>{
 const path=key(large),client=new ObjectStore(config.storage),send=client.client.send.bind(client.client);let writes=0;
 client.client.send=async(command,options)=>{
  const result=await send(command,options);
  if(command instanceof PutObjectCommand){writes++;throw new Error('TEST_FIXTURE_LOST_ACK');}
  return result;
 };
 try{
  await assert.rejects(client.persist(path,large,'video/mp4',sha),/TEST_FIXTURE_LOST_ACK/);
  assert.equal(await client.persist(path,large,'video/mp4',sha),'existing-verified');assert.equal(writes,1);
 }finally{client.close();}
});
test('video conflicts and oversize existing objects fail closed without overwriting the object',async()=>{
 const wrong=Buffer.alloc(large.length,0x42),path=key(large);
 await store.client.send(new PutObjectCommand({Bucket:config.storage.bucket,Key:path,Body:wrong,ContentType:'video/mp4'}));
 await assert.rejects(store.persist(path,large,'video/mp4',sha),/CANONICAL_INTEGRITY_CONFLICT/);
 assert.equal(digest(await store.read(path,MAX_CANONICAL_VIDEO_BYTES)),digest(wrong));
 const small=Buffer.from('TEST FIXTURE'),other=key(small);
 await store.client.send(new PutObjectCommand({Bucket:config.storage.bucket,Key:other,Body:large,ContentType:'image/png'}));
 await assert.rejects(store.persist(other,small,'image/png',digest(small)),/FILE_TOO_LARGE/);
 assert.equal(digest(await store.read(other,MAX_CANONICAL_VIDEO_BYTES)),sha);
});
test('larger canonical-video allowance cannot enlarge image/document writes or accept empty/unbounded reads',async()=>{
 for(const type of ['image/png','application/pdf','video/MP4','application/octet-stream'])
  await assert.rejects(store.persist(key(large),large,type,sha),/CANONICAL_SIZE_INVALID/);
 const tooLarge=Buffer.alloc(MAX_CANONICAL_VIDEO_BYTES+1);
 await assert.rejects(store.persist(key(tooLarge),tooLarge,'video/mp4',digest(tooLarge)),/CANONICAL_SIZE_INVALID/);
 await assert.rejects(store.persist(key(Buffer.alloc(0)),Buffer.alloc(0),'video/mp4',digest(Buffer.alloc(0))),/CANONICAL_SIZE_INVALID/);
 for(const limit of [0,-1,Infinity,NaN,1.5,MAX_CANONICAL_VIDEO_BYTES+1])await assert.rejects(store.read('not-contacted',limit),/OBJECT_READ_LIMIT_INVALID/);
});
test('canonical size checks retain content-addressed key and exact byte integrity requirements',async()=>{
 const path=key(large);
 await assert.rejects(store.persist(path,large,'video/mp4','b'.repeat(64)),/CANONICAL_INTEGRITY_CONFLICT/);
 await assert.rejects(store.persist(path+'/wrong',large,'video/mp4',sha),/CANONICAL_INTEGRITY_CONFLICT/);
 const small=Buffer.from('TEST FIXTURE: existing small-media behavior');const smallKey=key(small);
 await store.persist(smallKey,small,'image/png',digest(small));
 assert.equal(await store.persist(smallKey,small,'image/png',digest(small)),'existing-verified');
});

test('the exact 64 MiB canonical video boundary round-trips and replays through real storage',async()=>{
 const bytes=Buffer.alloc(MAX_CANONICAL_VIDEO_BYTES,0x56),path=key(bytes),sha=digest(bytes);
 await store.persist(path,bytes,'video/mp4',sha);
 assert.equal(await store.persist(path,bytes,'video/mp4',sha),'existing-verified');
 assert.equal(digest(await store.read(path,MAX_CANONICAL_VIDEO_BYTES)),sha);
});
test('conditional-write conflict recovery re-reads large saved videos with the correct bound',async()=>{
 const path=key(large);await store.persist(path,large,'video/mp4',sha);
 const client=new ObjectStore(config.storage),send=client.client.send.bind(client.client);let reads=0,writes=0;
 client.client.send=async(command,options)=>{
  // Fault injection models a real S3 precondition race. The saved bytes and
  // final GET are genuine; Garage may not itself enforce If-None-Match.
  if(command instanceof GetObjectCommand&&reads++===0)throw Object.assign(new Error('TEST_FIXTURE_MISSING'),{$metadata:{httpStatusCode:404}});
  if(command instanceof PutObjectCommand){writes++;throw Object.assign(new Error('TEST_FIXTURE_PRECONDITION'),{$metadata:{httpStatusCode:412}});}
  return send(command,options);
 };
 try{assert.equal(await client.persist(path,large,'video/mp4',sha),'existing-verified');assert.equal(reads,2);assert.equal(writes,1);}
 finally{client.close();}
});
