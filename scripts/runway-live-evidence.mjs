// Aggregate only observed hosted UI + provider ledger evidence, never mocks.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=name=>JSON.parse(readFileSync(`docs/evidence/${name}.json`,'utf8'));
const chats=['reel','video'].map(kind=>({kind,...read(`runway-chat-live-${kind}`)}));
const ledger=read('runway-provider-live'),media=read('runway-media-normalization');
assert.equal(media.passed,true);
const results=chats.map(chat=>{
 assert.equal(chat.passed,true);assert.equal(chat.status,'succeeded');assert.equal(chat.error_code,null);
 for(const check of ['chat_script_saved','approved_through_ui','actual_video_plays','saved_video_and_download_survive_reload'])assert.ok(chat.checks.includes(check));
 assert.equal(chat.metadata.width,chat.kind==='reel'?1080:1024);assert.equal(chat.metadata.height,chat.kind==='reel'?1920:1024);assert.ok(Math.abs(chat.metadata.duration-5)<.25);
 const operation=ledger.operations.find(row=>row.job_id===chat.job);
 assert.equal(operation?.provider,'runway');assert.equal(operation.phase,'completed');assert.equal(operation.status,'succeeded');assert.equal(operation.output_version_id,chat.version);
 assert.equal(operation.routing.optimize_for,'quality');assert.ok(operation.routing.estimated_credits<=operation.routing.max_credits);
 return {kind:chat.kind,conversation_id:chat.conversation,job_id:chat.job,version_id:chat.version,metadata:chat.metadata,routing:operation.routing};
});
const report={checked_at:new Date().toISOString(),state:'LIVE_VERIFIED',passed:true,scope:'Two actual five-second Runway creations, through hosted chat with explicit prompt approval, saved private assets, decoded playback, reload and download controls. No social publishing.',results,estimated_credits:results.reduce((n,r)=>n+r.routing.estimated_credits,0),limitations:['Silent video; native narration/audio not enabled.','First-frame routing can follow reference aspect. A square source is preserved with padding in a vertical Reel; use a matching portrait reference for full-frame portrait output.','Quality preference is model selection, not a guarantee of artifact-free results. Visual review remains required.','This evidence does not establish full production readiness, edit coverage or social publishing.'],evidence:['runway-chat-live-reel.json','runway-chat-live-video.json','runway-provider-live.json','runway-media-normalization.json','runway-real-media-conversion.json','runway-media-recovery.json']};
writeFileSync('docs/evidence/runway-live.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
