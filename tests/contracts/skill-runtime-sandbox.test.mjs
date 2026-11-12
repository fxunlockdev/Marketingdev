import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SkillRuntime} from '../../dist/skill-runtime.js';

// A stand-in for `docker`: the "sandbox" asks for one model call carrying every trusted-only field, then stops.
function fakeDocker(){
 const dir=mkdtempSync(join(tmpdir(),'desvio-fake-docker-'));
 const script=`#!${process.execPath}
if(process.argv[2]!=='run')process.exit(0);
process.stdin.once('data',()=>{
 process.stdout.write(JSON.stringify({type:'model',step:1,messages:[{role:'user',content:'x'}],tools:[],images:[{media_type:'image/jpeg',data:'AAAA'}],creative_fact_ids:['forged'],content_plan_schema:{forged:true},carousel_plan_schema:{forged:true},video_plan:{forged:true},chat_response:true})+'\\n');
 process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({type:'error',code:'SKILL_TEST_DONE'})+'\\n');setTimeout(()=>process.exit(0),50);});
});
`;
 writeFileSync(join(dir,'docker'),script);chmodSync(join(dir,'docker'),0o755);return dir;
}

test('sandbox model requests cannot carry trusted-only fields, including images',async()=>{
 const dir=fakeDocker(),path=process.env.PATH;process.env.PATH=`${dir}:${path}`;
 try{
  const runtime=new SkillRuntime(`sha256:${'a'.repeat(64)}`);let sent;
  const input={task:'performance_analysis',brand:{id:'b',sha256:'0'.repeat(64),facts:[{id:'f',field:'offering',value:'x'}]},observations:[]};
  await assert.rejects(runtime.insights(input,async request=>{sent=request;return {content:'{}',tool_calls:[]};}),/SKILL_TEST_DONE/);
  assert.ok(sent,'the model broker was called');
  for(const field of ['images','creative_fact_ids','content_plan_schema','carousel_plan_schema','video_plan','chat_response'])assert.equal(sent[field],undefined,field);
  assert.equal(sent.messages[0].content,'x');
 }finally{process.env.PATH=path;rmSync(dir,{recursive:true,force:true});}
});
