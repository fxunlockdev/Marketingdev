import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reelShots,reelShotSeconds,reelCaptions,reelOverlays,reelSamples,reelStyle,videoTarget,captionLines,storyShots} from '../../dist/reel-plan.js';
import {RunwayClient,RUNWAY_VIDEO_MODEL,RUNWAY_PROMPT_MAX} from '../../dist/runway-client.js';
const brief={title:'Reel',caption:'Caption',video_prompt:'Warm bakery at dawn, steam over loaves.',fact_ids:['f1'],warnings:[],
 beats:[{start_ms:0,end_ms:5000,action:'Baker lifts a tray',camera:'Slow push in'},{start_ms:5000,end_ms:10000,action:'Loaves cool on racks',camera:'Pan right'},{start_ms:10000,end_ms:15000,action:'Customer smiles at counter',camera:'Static'}],
 overlays:[{text:'Fresh daily',start_ms:0,end_ms:3000,position:'top',foreground:'#ffffff',background:'#000000'}]};
const storyline={kind:'video',concept:'Morning bake',shots:[{visual:'Baker lifts a tray of sourdough',camera:'Push in',on_screen_text:'Baked at 5am'},{visual:'Loaves on cooling racks',camera:'Pan',on_screen_text:'Small batches'},{visual:'Customer at the counter',camera:'Static',on_screen_text:'See you tomorrow'}]};

test('reel shot length keeps the cut between 15 and 30 seconds',()=>{
 assert.equal(reelShotSeconds(15,3),5);assert.equal(reelShotSeconds(15,2),8);assert.equal(reelShotSeconds(15,5),3);assert.equal(reelShotSeconds(5,2),8);assert.equal(reelShotSeconds(15,1===1?4:4),4);
 for(const n of [2,3,4,5])for(const d of [3,5,10,15]){const t=reelShotSeconds(d,n)*n;assert.ok(t>=15&&t<=30,`${n}x${d}=${t}`);}
 assert.throws(()=>reelShotSeconds(15,6),/VIDEO_REEL_INVALID/);assert.throws(()=>reelShotSeconds(15,1),/VIDEO_REEL_INVALID/);
});
test('each shot prompt carries the exact approved direction, its reviewed shot and its beats, uncut',()=>{
 const shots=reelShots(brief,storyline,3,15);
 assert.equal(shots.length,3);assert.deepEqual(shots.map(s=>[s.start_ms,s.end_ms,s.duration_seconds]),[[0,5000,5],[5000,10000,5],[10000,15000,5]]);
 assert.equal(shots[0].prompt,'Warm bakery at dawn, steam over loaves.\nShot 1 of 3 (5 seconds), one continuous take from the opening frame.\nShot: Baker lifts a tray of sourdough Camera: Push in.\nScript:\nBaker lifts a tray Camera: Slow push in');
 assert.ok(shots[2].prompt.includes('Customer at the counter')&&shots[2].prompt.includes('Customer smiles at counter'));
 assert.throws(()=>reelShots({...brief,video_prompt:'x'.repeat(RUNWAY_PROMPT_MAX)},storyline,3,15),/RUNWAY_PROMPT_TOO_LONG/);
 const noStory=reelShots(brief,null,2,15);assert.ok(noStory[0].prompt.includes('Baker lifts a tray')&&noStory[0].prompt.includes('Loaves cool'));assert.ok(!noStory[0].prompt.includes('Shot: '));
});
test('captions come from the script, are timed to shots and never drop words',()=>{
 const shots=reelShots(brief,storyline,3,15);
 const captions=reelCaptions('We bake at five. Every loaf is shaped by hand. Come by before nine.',storyline,shots);
 assert.deepEqual(captions,[{text:'We bake at five.',start_ms:0,end_ms:5000},{text:'Every loaf is shaped by hand.',start_ms:5000,end_ms:10000},{text:'Come by before nine.',start_ms:10000,end_ms:15000}]);
 assert.deepEqual(reelCaptions('',storyline,shots).map(c=>c.text),['Baked at 5am','Small batches','See you tomorrow']);
 assert.deepEqual(reelCaptions(null,null,shots),[]);
 const long='word '.repeat(60);assert.equal(captionLines(long).join(' '),long.trim());assert.ok(captionLines(long).every(l=>l.length<=120));
 assert.throws(()=>reelCaptions('a '.repeat(2000),null,shots),/VIDEO_CAPTION_TOO_LONG/);
});
test('overlays stretch onto the reel, samples hit captioned shots and the end card, portrait is true 4:5',()=>{
 const shots=reelShots(brief,storyline,3,10);
 assert.deepEqual(reelOverlays(brief,10,shots)[0],{...brief.overlays[0],start_ms:0,end_ms:4500});
 const captions=reelCaptions('One. Two. Three.',null,shots);assert.deepEqual(reelSamples(shots,captions,true),[2500,7500,12500,16000]);
 assert.deepEqual(videoTarget('portrait'),{width:1080,height:1350});assert.deepEqual(videoTarget('vertical'),{width:1080,height:1920});
 assert.equal(reelStyle('Playfair Display',{foreground:'#ffffff',background:'#000000'}).font,'serif');assert.equal(reelStyle('Inter',{foreground:'#ffffff',background:'#000000'},true).caption_scale,130);
 assert.equal(storyShots({kind:'image'}).length,0);
});
test('Runway refuses an over-long prompt by name instead of cutting it',()=>{
 const c=new RunwayClient({mode:'test',secret:'s',referenceOrigins:['https://media.example.com']},async()=>{throw Error('no call');});
 const intent={kind:'image',model:RUNWAY_VIDEO_MODEL,idempotencyKey:randomUUID(),referenceURL:'https://media.example.com/a.png',prompt:'x'.repeat(RUNWAY_PROMPT_MAX+1),durationSeconds:5,sound:'off',aspectRatio:'9:16',maxCredits:10};
 assert.throws(()=>c.prepare(intent),/RUNWAY_PROMPT_TOO_LONG/);
 assert.throws(()=>c.prepare({...intent,durationSeconds:3,routingProfile:'short-clip-v1',prompt:'x'.repeat(1001)}),/RUNWAY_PROMPT_TOO_LONG/);
 const exact=c.prepare({...intent,prompt:'x'.repeat(RUNWAY_PROMPT_MAX)});assert.equal(JSON.parse(exact.body).input.promptText.length,RUNWAY_PROMPT_MAX);
 const body=JSON.parse(c.prepare({...intent,prompt:'Approved'}).body);
 assert.deepEqual(body.input,{referenceImages:[{uri:'https://media.example.com/a.png',role:'first'}],promptText:'Approved',duration:5,aspectRatio:'9:16',resolution:'1080p',audio:false});
});
test('brand palette keeps captions legible and the end card on brand',async()=>{
 const {brandPalette,brandName,reelEndCard}=await import('../../dist/reel-plan.js');
 assert.deepEqual(brandPalette([{field:'colors',value:'Navy #1B2A49 and cream #F5EEDC'}]),{caption:{foreground:'#ffffff',background:'#1b2a49'},card:{background:'#1b2a49',foreground:'#ffffff'}});
 assert.deepEqual(brandPalette([{field:'colors',value:'Lemon #FFE45C'}]),{caption:{foreground:'#ffffff',background:'#111111'},card:{background:'#ffe45c',foreground:'#111111'}});
 assert.deepEqual(brandPalette([]).card,{background:'#111111',foreground:'#ffffff'});
 assert.equal(brandName([{field:'brand_name',value:' Groomday '}]),'Groomday');
 assert.deepEqual(reelEndCard('Groomday','Book a visit',{foreground:'#ffffff',background:'#111111'}),{headline:'Groomday',cta:'Book a visit',foreground:'#ffffff',background:'#111111',duration_ms:2000});
});
test('an approved monthly video with a reviewed multi-shot storyline is queued as a reel',async()=>{
 const {monthlyVideoRequest}=await import('../../dist/guided-videos.js');
 const slot={id:'s1',revision:3,brief:'Morning bake',channel:'instagram',creative_spec:{placement:'reel',aspect:'vertical',slide_count:null},storyline,video_draft:{storyline:'Bake',script:'We bake at five.',prompt:'Warm light',duration_seconds:15}};
 const reference={brand_reference_id:'r1',source_sha256:'a'.repeat(64),confirmed:true};
 assert.deepEqual(monthlyVideoRequest(slot,reference),{prompt:'Morning bake\nStoryline: Bake\nScript: We bake at five.\nPrompt: Warm light',channel:'instagram',duration_seconds:15,shots:3,creative_spec:slot.creative_spec,slot_id:'s1',slot_revision:3,reference,generate:true});
 assert.equal(monthlyVideoRequest({...slot,storyline:{kind:'video',concept:'x',shots:storyline.shots.slice(0,1)}},reference).shots,undefined);
 assert.equal(monthlyVideoRequest({...slot,storyline:{kind:'video',concept:'x',shots:[...storyline.shots,...storyline.shots]}},reference).shots,5);
 assert.equal(monthlyVideoRequest({...slot,video_draft:null,storyline:null},reference).duration_seconds,5);
});
