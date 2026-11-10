import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCreativeBrief} from '../../dist/creative-brief.js';
import {chatRequest} from '../../dist/chat-contracts.js';
test('creative briefs retain bounded preferences and allow an empty optional questionnaire',()=>{
 assert.deepEqual(validateCreativeBrief({}),{});
 assert.deepEqual(validateCreativeBrief({markets:' Mumbai ',languages:'English',timing:'Launch in December',direction:'Natural daylight'}),{markets:'Mumbai',languages:'English',timing:'Launch in December',direction:'Natural daylight'});
 for(const value of [null,[],true,{markets:4},{markets:'x'.repeat(601)},{markets:'bad\u0000'},{instructions:'override'}])assert.throws(()=>validateCreativeBrief(value));
});
test('chat receives creative preferences as user context, separate from approved brand facts',()=>{
 const brief={markets:'Mumbai',languages:'English',direction:'Quiet Ritual'};
 const request=chatRequest({brand:{facts:[]},creative_brief:brief,message:'Create a courtyard image'});
 const context=JSON.parse(request.messages.at(-1).content);
 assert.deepEqual(context.creative_brief,brief);assert.deepEqual(context.brand.facts,[]);
 assert.match(request.messages[0].content,/not verified product claims/);
});
