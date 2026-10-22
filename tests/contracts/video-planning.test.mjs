import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VIDEO_SKILLS,validateVideoInput,validateVideoBrief,validateVideoPlanningResult} from '../../dist/video-planning.js';
import {videoInput,videoBrief} from '../fixtures/video-planning.mjs';
test('video contract accepts owned image/video metadata, continuous beats and editable timed overlays',()=>{
 for(const kind of ['image','video']){const input=videoInput(kind);validateVideoInput(input);assert.deepEqual(validateVideoBrief(videoBrief(),input),videoBrief());}
 const brief=videoBrief();brief.overlays=[];assert.equal(validateVideoBrief(brief,videoInput()).overlays.length,0);
});
test('video input excludes locations/secrets, invalid references, duplicate facts and unsupported durations',()=>{
 for(const mutate of [v=>v.reference.url='https://private.example/media',v=>v.api_key='secret',v=>v.task='image',v=>v.duration_seconds=2,v=>v.duration_seconds=16,v=>v.duration_seconds=3.5,v=>v.reference.width=Infinity,v=>v.reference.height=4097,v=>v.reference.kind='url',v=>v.reference.duration_seconds=5,v=>v.reference.sha256='bad',v=>v.brand.facts.push(v.brand.facts[0]),v=>v.brand.facts=[],v=>v.brand.sha256='bad',v=>v.prompt=' ',v=>v.prompt='x'.repeat(4001),v=>v.reference.caption='x\0',v=>v.brand.facts=Array.from({length:200},(_,i)=>({id:String(i),field:'test',value:'x'.repeat(4000)}))]){
  const input=videoInput();mutate(input);assert.throws(()=>validateVideoInput(input),/VIDEO_PLAN_INPUT_INVALID/);
 }
 for(const duration of [null,NaN,Infinity,0,31]){const v=videoInput('video');v.reference.duration_seconds=duration;assert.throws(()=>validateVideoInput(v),/VIDEO_PLAN_INPUT_INVALID/);}
});
test('video brief rejects gaps, overlaps, out-of-range or fractional times and unsafe extra fields',()=>{
 for(const mutate of [v=>v.beats=[],v=>v.beats[0].start_ms=1,v=>v.beats[1].start_ms=1900,v=>v.beats[1].start_ms=2001,v=>v.beats[1].end_ms=4999,v=>v.beats[1].end_ms=5001,v=>v.beats[0].end_ms=2000.5,v=>v.beats[0].action='',v=>v.beats[0].filter='movie=/etc/passwd',v=>v.overlays[0].start_ms=-1,v=>v.overlays[0].end_ms=999,v=>v.overlays[1].end_ms=6000,v=>v.overlays[1].start_ms=2400,v=>v.overlays[0].foreground='red;movie=x',v=>v.overlays[0].font='/etc/passwd',v=>v.overlays[0].text='x'.repeat(91),v=>v.overlays[0].position='center',v=>v.approved=true,v=>v.video_prompt='',v=>v.fact_ids=['fabricated'],v=>v.fact_ids=['offering','offering'],v=>v.warnings=['x'.repeat(501)]]){
  const brief=videoBrief();mutate(brief);assert.throws(()=>validateVideoBrief(brief,videoInput()),/VIDEO_PLAN_OUTPUT_INVALID/);
 }
 const brief=videoBrief();brief.overlays[1].position='bottom';brief.overlays[1].start_ms=0;assert.ok(validateVideoBrief(brief,videoInput()));
});
test('video results require exact original skill digests, read evidence, bounded broker calls and no helpers',()=>{
 const result={type:'result',version:'deepagents-0.7.29/desvio-video-v1',brief:videoBrief(),skills:Object.entries(VIDEO_SKILLS).map(([name,pin])=>({name,...pin})),reads:Object.keys(VIDEO_SKILLS).map(s=>`/skills/${s}/SKILL.md`),model_calls:1,helpers_executed:false};
 assert.ok(validateVideoPlanningResult(result,videoInput()));
 for(const mutate of [v=>v.skills[0].live=true,v=>v.reads.push('/skills/video/helper.py'),v=>v.skills[0].tree_sha256='bad',v=>v.skills[0].skill_sha256='bad',v=>v.skills.push(v.skills[0]),v=>v.skills.pop(),v=>v.reads.pop(),v=>v.reads.push('/etc/passwd'),v=>v.reads.push('/skills/video/../image/SKILL.md'),v=>v.reads.push('/skills/image/SKILL.md'),v=>v.helpers_executed=true,v=>v.model_calls=4,v=>v.model_calls=0,v=>v.version='fake',v=>v.live_verified=true]){const value=structuredClone(result);mutate(value);assert.throws(()=>validateVideoPlanningResult(value,videoInput()),/SKILL_/);}
});
