import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keyframeRequest,keyframeAspect,keyframeReference} from '../../dist/reel-keyframe.js';
import {normalizeCreativeSpec,creativeDimensions} from '../../dist/campaign-formats.js';
test('a starting frame is an image-engine request at the video aspect, with no lettering',()=>{
 const vertical=keyframeRequest({prompt:'Baker lifts a tray of bread',channel:'instagram',aspect:'vertical'});
 assert.equal(vertical.size,'1024x1536');assert.deepEqual(vertical.creative_spec,{placement:'story',aspect:'vertical',slide_count:null});
 assert.deepEqual(creativeDimensions(normalizeCreativeSpec(vertical.creative_spec,'static','instagram')),{width:1080,height:1920},'A 9:16 video starts from a true 9:16 frame');
 const portrait=keyframeRequest({prompt:'x',channel:'facebook',aspect:'portrait'});
 assert.deepEqual(creativeDimensions(normalizeCreativeSpec(portrait.creative_spec,'static','facebook')),{width:1024,height:1280},'A 4:5 video starts from a true 4:5 frame');
 const linkedinPortrait=keyframeRequest({prompt:'x',channel:'linkedin',aspect:'portrait'});
 assert.deepEqual(creativeDimensions(normalizeCreativeSpec(linkedinPortrait.creative_spec,'static','linkedin')),{width:1024,height:1280});
 const linkedinVertical=keyframeRequest({prompt:'x',channel:'linkedin',aspect:'vertical'});
 assert.equal(linkedinVertical.size,'1024x1536');assert.equal(linkedinVertical.creative_spec,undefined,'LinkedIn has no story placement; its tall frame stays 2:3');
 assert.match(vertical.prompt,/no words, letters, numbers or captions/);assert.match(vertical.prompt,/Video brief: Baker lifts a tray of bread$/);
 const landscape=keyframeRequest({prompt:'x',channel:'linkedin',aspect:'landscape'});assert.deepEqual(creativeDimensions(normalizeCreativeSpec(landscape.creative_spec,'static','linkedin')),{width:1536,height:1024});
 assert.equal(keyframeRequest({prompt:'x',channel:'instagram',aspect:'square'}).size,'1024x1024');
 assert.throws(()=>keyframeRequest({prompt:'  ',channel:'instagram',aspect:'square'}),/Describe/);
 assert.throws(()=>keyframeRequest({prompt:'x'.repeat(4000),channel:'instagram',aspect:'square'}),/Shorten/);
 assert.equal(keyframeAspect('reel','1024x1024'),'vertical');assert.equal(keyframeAspect('feed','1024x1536'),'portrait');assert.equal(keyframeAspect('feed','1536x1024'),'landscape');
});
test('only the approved PNG export of the frame becomes a video reference',()=>{
 const state={renderer_image:'sha256:r',exports:[{id:'e1',format:'png',renderer_image:'sha256:r',source_sha256:'s',sha256:'x'}],approvals:[]};
 assert.equal(keyframeReference(state,'v1'),null);
 assert.equal(keyframeReference({...state,approvals:[{id:'a1',export_id:'e1',context_type:'canvas',context_id:'other'}]},'v1'),null);
 assert.deepEqual(keyframeReference({...state,approvals:[{id:'a1',export_id:'e1',context_type:'canvas',context_id:'v1'}]},'v1'),{export_id:'e1',approval_id:'a1',source_sha256:'s',export_sha256:'x'});
 assert.equal(keyframeReference({...state,exports:[{...state.exports[0],renderer_image:'sha256:old'}],approvals:[{id:'a1',export_id:'e1',context_type:'canvas',context_id:'v1'}]},'v1'),null);
});
