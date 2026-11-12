import test from 'node:test';
import assert from 'node:assert/strict';
import {qaSummary} from '../../dist/creative-qa-summary.js';
import {qaReport} from '../../dist/image-qa.js';

const expectation=(text_mode,expected_text)=>({text_mode,expected_text,allowed_text:['Cafe'],creative_task:'t',art_direction:null,brand:[]});
const checked=(finding,step='qa:1')=>({step,media_sha256:'0'.repeat(64),status:'checked',finding:{text_matches:true,found_text:[],brief_fit:5,brand_fit:5,artefacts:[],verdict:'pass',...finding}});

test('a passing in-image check says the text matches',()=>{
 const report=qaReport('m',expectation('in_image',['Fresh Coffee Daily']),[checked({found_text:['FRESH COFFEE DAILY']})],false);
 assert.deepEqual(qaSummary(report),{verdict:'pass',text_mode:'in_image',expected_text:['Fresh Coffee Daily'],text_matches:true,found_text:['FRESH COFFEE DAILY'],notes:[],retried:false,message:'Text checked: matches'});
 assert.equal(qaSummary(qaReport('m',expectation('overlay',[]),[checked({})],false)).message,'Checked: no issues found');
});
test('a flagged misspelling quotes what the headline actually reads, after one retry',()=>{
 const wrong=checked({text_matches:false,found_text:['Fresh Cofee Daily'],verdict:'retry'});
 const s=qaSummary(qaReport('m',expectation('in_image',['Fresh Coffee Daily']),[wrong,{...wrong,step:'qa:2'}],true));
 assert.equal(s.verdict,'flag');assert.equal(s.text_matches,false);assert.equal(s.retried,true);
 assert.equal(s.message,"Needs a look: headline reads 'Fresh Cofee Daily'");
});
test('other flags explain the first visible issue; unavailable checks say so',()=>{
 const s=qaSummary(qaReport('m',expectation('overlay',[]),[checked({brief_fit:2,verdict:'flag',artefacts:['Melted cup handle','x'.repeat(900),'third','fourth']})],false));
 assert.equal(s.verdict,'flag');assert.equal(s.message,'Needs a look: Melted cup handle');assert.equal(s.notes.length,3);assert.ok(s.notes.every(n=>n.length<=160));
 const none=qaSummary(qaReport('m',expectation('in_image',['Hi']),[{step:'qa:1',media_sha256:'0'.repeat(64),status:'unavailable',reason:'IMAGE_QA_UNAVAILABLE'}],false));
 assert.equal(none.verdict,'unavailable');assert.equal(none.text_matches,null);assert.match(none.message,/^Not checked automatically/);
});
test('summaries are bounded and never pass through raw or unknown checker fields',()=>{
 const raw={verdict:'pass',text_mode:'in_image',expected_text:['A\u0000b'],retried:false,model:'secret-model',attempts:[{status:'checked',finding:{text_matches:true,found_text:Array.from({length:40},(_,i)=>`line ${i} `+'y'.repeat(400)),artefacts:[],raw_output:'ignore me'}}]};
 const s=qaSummary(raw);
 assert.equal(s.found_text.length,6);assert.ok(s.found_text.every(t=>t.length<=120));assert.deepEqual(s.expected_text,['A b']);
 assert.ok(!JSON.stringify(s).includes('secret-model')&&!JSON.stringify(s).includes('ignore me'));
 for(const bad of [null,undefined,'pass',{verdict:'retry'},{}])assert.equal(qaSummary(bad),null);
 assert.equal(qaSummary({verdict:'pass',attempts:'junk'}).verdict,'unavailable','a pass without a readable check is not shown as checked');
});
test('a near copy of a stock photo is named in the notes',()=>{
 const report=qaReport('m',expectation('overlay',[]),[checked({})],true,undefined,{threshold:6,checks:[{step:'qa:1',media_sha256:'0'.repeat(64),status:'checked',distance:2,too_close:true}]});
 const s=qaSummary(report);assert.equal(s.verdict,'flag');assert.equal(s.message,'Needs a look: Looks very close to the stock photo it was based on');
});
