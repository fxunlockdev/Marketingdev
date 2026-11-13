import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentReachRuntimeSettings} from '../../infra/worker-control/agent-reach-settings.mjs';
const image='sha256:'+'c'.repeat(64),inventory=[{role:'trusted_worker',image_id:'sha256:'+'a'.repeat(64)},{role:'agent_reach',image_id:image}];
test('absent switch and image leave the worker unchanged',()=>{
 assert.deepEqual(agentReachRuntimeSettings({},[{role:'trusted_worker',image_id:'sha256:'+'a'.repeat(64)}]),{});
 assert.deepEqual(agentReachRuntimeSettings({AGENT_REACH_ENABLED:''},[]),{});
});
test('the inventory image is pinned and the explicit switch is carried',()=>{
 assert.deepEqual(agentReachRuntimeSettings({AGENT_REACH_ENABLED:'true'},inventory),{AGENT_REACH_IMAGE:image,AGENT_REACH_ENABLED:'true'});
 assert.deepEqual(agentReachRuntimeSettings({AGENT_REACH_ENABLED:'false'},inventory),{AGENT_REACH_IMAGE:image,AGENT_REACH_ENABLED:'false'});
 assert.deepEqual(agentReachRuntimeSettings({},inventory),{AGENT_REACH_IMAGE:image});
});
test('enabling without a reviewed image or with a malformed value is refused',()=>{
 assert.throws(()=>agentReachRuntimeSettings({AGENT_REACH_ENABLED:'true'},[]),/INVALID_AGENT_REACH_SETTINGS/);
 assert.throws(()=>agentReachRuntimeSettings({AGENT_REACH_ENABLED:'yes'},inventory),/INVALID_AGENT_REACH_SETTINGS/);
 assert.throws(()=>agentReachRuntimeSettings({AGENT_REACH_ENABLED:'true'},[{role:'agent_reach',image_id:'latest'}]),/INVALID_AGENT_REACH_SETTINGS/);
});
