import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CHAT_MODEL,chatRequest,validateChatDecision} from '../../dist/chat-contracts.js';
const context={today:'2026-10-31',memories:[{id:'saved-campaign'}],current_image:null};
const decision={reply:'I’ll prepare it.',action:'image',prompt:'Luxury residences without text',channel:'instagram',size:'1024x1024',sources:[],starts_on:null,text_mode:'none'};
test('chat decisions cannot invent memory sources, dates or image parents',()=>{
 assert.equal(CHAT_MODEL,'gpt-6-sol');assert.equal(validateChatDecision(decision,context).action,'image');
 for(const change of [{sources:['invented']},{action:'edit_image'},{action:'campaign',starts_on:null},{action:'campaign',starts_on:'2026-02-31'},{action:'campaign',starts_on:'2026-10-30'},{text_mode:'unreadable'},{extra:'field'}])assert.throws(()=>validateChatDecision({...decision,...change},context),/CHAT_RESPONSE_INVALID/);
 assert.equal(validateChatDecision({...decision,action:'campaign',starts_on:'2026-11-15'},context).starts_on,'2026-11-15');
 assert.equal(validateChatDecision({...decision,action:'answer',prompt:'',sources:['saved-campaign']},context).action,'answer');
 const request=chatRequest({...context,brand:{facts:[]},message:'What next?'});assert.equal(request.chat_response,true);assert.deepEqual(request.tools,[]);
});

test('chat media decisions retain requested carousel count, reel framing and duration',()=>{
 const full={...decision,slide_count:4,placement:'feed',duration_seconds:5,action:'carousel'};
 assert.equal(validateChatDecision(full,context).slide_count,4);
 assert.equal(validateChatDecision({...full,action:'video',placement:'reel',size:'1024x1536',duration_seconds:8},context).duration_seconds,8);
 for(const patch of [{slide_count:1},{slide_count:11},{slide_count:2.5},{placement:'reel'},{action:'video',placement:'reel',size:'1024x1536',channel:'linkedin'},{duration_seconds:16},{duration_seconds:0}])assert.throws(()=>validateChatDecision({...full,...patch},context),/CHAT_RESPONSE_INVALID/);
 assert.equal(validateChatDecision(decision,context).action,'image','Existing saved turns remain executable after rollout');
});
