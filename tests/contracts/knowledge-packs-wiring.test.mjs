import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SkillRuntime} from '../../dist/skill-runtime.js';
import {shotListSection} from '../../dist/video-jobs.js';
import {carouselInput} from '../fixtures/carousel-planning.mjs';

const pack={task:'carousel',notice:'TEST notice',items:[{id:'n1',type:'angle',label:'TEST angle',summary:'',standing:'approved',confidence:1,relations:[]}],ledger:[],truncated:false};

test('a stored pack reaches the carousel and video sandboxes as brand.knowledge without changing the stored input',async()=>{
 const runtime=new SkillRuntime(),input=carouselInput(3);let sent;
 runtime.run=async value=>{sent=value;return {};};
 await runtime.carouselPlan(input,async()=>({}),pack);
 assert.deepEqual(sent.brand.knowledge,pack);assert.equal(input.brand.knowledge,undefined,'the stored input is not changed');
 assert.deepEqual(Object.keys(sent).sort(),Object.keys(input).sort(),'top-level keys stay exact for the sandbox');
 await runtime.carouselPlan(input,async()=>({}));assert.equal(sent,input);
 const video={task:'video',brand:input.brand,prompt:'TEST video',channel:'instagram',duration_seconds:5,reference:{kind:'image',sha256:'a'.repeat(64),width:1024,height:1024,duration_seconds:null,caption:''}};
 await runtime.videoPlan(video,async()=>({}),{...pack,task:'video'});assert.equal(sent.brand.knowledge.task,'video');assert.equal(sent.prompt,'TEST video');
});

test('the reviewed shot list is a bounded "Shot list:" section, one line per shot, in order',()=>{
 const storyline={kind:'video',concept:'c',shots:[{visual:'TEST owner\nopens app',camera:'close-up',on_screen_text:''},{visual:'TEST calendar fills',camera:'slow pan',on_screen_text:'Booked'}]};
 assert.equal(shotListSection(storyline,4000),'\nShot list:\n1. TEST owner opens app Camera: close-up.\n2. TEST calendar fills Camera: slow pan. On-screen text: Booked');
 assert.equal(shotListSection(storyline,60),'\nShot list:\n1. TEST owner opens app Camera: close-up.');
 assert.equal(shotListSection(storyline,10),null);
 assert.equal(shotListSection({kind:'static',concept:'c'},4000),null);assert.equal(shotListSection(null,4000),null);
});
