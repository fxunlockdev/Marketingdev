import test from 'node:test';
import assert from 'node:assert/strict';
import {ObjectStore} from '../../dist/object-store.js';
const store=new ObjectStore({endpoint:'https://media.example.test',region:'test',bucket:'private',accessKeyId:'MOCK',secretAccessKey:'MOCK'});
const id='00000000-0000-4000-8000-000000000001',key=`video-reference/${id}/${id}/${id}/${'a'.repeat(64)}`;
test('reference signing caps database clock skew without exceeding either the saved deadline or eight hours',async()=>{
 for(const remaining of [28805,28800,28795,300]){
  const deadline=new Date(Date.now()+remaining*1000),url=new URL(await store.referenceURL(key,deadline));
  const seconds=Number(url.searchParams.get('X-Amz-Expires')),raw=url.searchParams.get('X-Amz-Date');
  const signed=Date.parse(raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z'));
  assert.ok(seconds>=60&&seconds<=28800);assert.ok(signed+seconds*1000<=deadline.getTime());
 }
 for(const deadline of [new Date(NaN),new Date(Date.now()-1000),new Date(Date.now()+30000)])await assert.rejects(store.referenceURL(key,deadline),/REFERENCE_LEASE_INVALID/);
 await assert.rejects(store.referenceURL('other-business/file',new Date(Date.now()+300000)),/REFERENCE_LEASE_INVALID/);
});
