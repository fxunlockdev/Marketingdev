import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationChannel,validReel} from '../../dist/publication-provider.js';
const valid=()=>({sha256:'a'.repeat(64),bytes:'100000',manifest:{video_sha256:'a'.repeat(64),metadata:{codec:'h264',audio:false,width:1080,height:1920,duration_ms:3000}}});
test('Reel eligibility requires canonical metadata bound to the approved bytes',()=>{
 assert.equal(validReel(valid()),true);
 for(const change of [r=>delete r.manifest.metadata,r=>r.manifest.video_sha256='b'.repeat(64),r=>r.manifest.metadata.codec='vp9',r=>r.manifest.metadata.width=1081,r=>r.manifest.metadata.height=2000,r=>r.manifest.metadata.duration_ms=2999,r=>r.manifest.metadata.duration_ms=15001,r=>r.bytes='10000000',r=>r.bytes='invalid',r=>delete r.manifest.metadata.audio]){
  const row=valid();change(row);assert.equal(validReel(row),false);
 }
 assert.equal(validReel(null),false);
 assert.equal(validReel({metadata:valid().manifest.metadata,bytes:100000}),false);
});
test('Publication destination mapping supports only implemented providers',()=>{
 assert.equal(publicationChannel('linkedin'),'linkedin');
 assert.equal(publicationChannel('instagram-standalone'),'instagram');
 assert.equal(publicationChannel('facebook'),'facebook');
 for(const provider of ['instagram','youtube','tiktok','twitter','google','unknown',''])assert.equal(publicationChannel(provider),null);
});
