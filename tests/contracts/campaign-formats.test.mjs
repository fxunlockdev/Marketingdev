import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreativeSpec,creativeDimensions,creativeSourceSize} from '../../dist/campaign-formats.js';
const spec=(placement='feed',aspect='square',slide_count=null)=>({placement,aspect,slide_count});
test('campaign format matrix preserves feed video and requires genuine vertical story/reel targets',()=>{
 for(const channel of ['instagram','facebook','linkedin'])for(const format of ['static','ad','video','carousel'])for(const aspect of ['square','portrait','landscape'])assert.deepEqual(normalizeCreativeSpec(spec('feed',aspect,format==='carousel'?3:null),format,channel),spec('feed',aspect,format==='carousel'?3:null));
 for(const channel of ['instagram','facebook'])for(const [format,placement] of [['static','story'],['video','story'],['video','reel']])assert.deepEqual(creativeDimensions(normalizeCreativeSpec(spec(placement,'vertical'),format,channel)),{width:1080,height:1920});
 assert.equal(creativeSourceSize(spec('story','vertical')),'1024x1536');
});
test('campaign specification rejects incompatible channels, dimensions, slide counts and unknown properties',()=>{
 const invalid=[[null,'static','instagram'],[spec('story','vertical'),'static','linkedin'],[spec('reel','vertical'),'static','instagram'],[spec('story','portrait'),'video','instagram'],[spec('feed','vertical'),'static','instagram'],[spec('feed','square',1),'carousel','instagram'],[spec('feed','square',2.5),'carousel','instagram'],[spec('feed','square',11),'carousel','instagram'],[spec('feed','square',2),'static','instagram'],[{...spec(),extra:true},'static','instagram'],[spec(),'static','youtube']];
 for(const args of invalid)assert.throws(()=>normalizeCreativeSpec(...args),{code:'CAMPAIGN_FORMAT_INVALID'});
});
