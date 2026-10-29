import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CampaignIdeas,ideaResponse,ideaSelection} from '../../dist/campaign-ideas.js';
import {PlanningJobs} from '../../dist/planning-jobs.js';
import {canonicalJSON,hash} from '../../dist/brand-brain.js';
import {PLANNING_SKILLS} from '../../dist/planning-contracts.js';
import {generatedPlan} from '../fixtures/planning.mjs';
const plan='22222222-2222-4222-8222-222222222222',brand='11111111-1111-4111-8111-111111111111';
function fixture(row,exists=true){const queries=[],submitted=[];return {queries,submitted,service:new CampaignIdeas({plans:{scope:async(user,id,write,fn)=>{assert.equal(id,brand);return fn({query:async(sql,args)=>{queries.push({sql,args});return sql.startsWith('SELECT id FROM')?{rowCount:exists?1:0,rows:[]}:{rows:row?[row]:[]};}},{organization_id:'tenant'});}},detail:async()=>({timezone:'UTC'}),submit:async(...args)=>{submitted.push(args);return {id:'new-job',status:'queued'};}})};}
test('post idea requests validate supported formats/channels and reject foreign campaigns',async()=>{
 for(const bad of [{format:'avatar',channel:'instagram'},{format:'static',channel:'tiktok'},{format:'static',channel:'instagram',brand:'forged'}])assert.throws(()=>ideaSelection(bad));
 await assert.rejects(fixture(null,false).service.latest('user',brand,plan,{format:'static',channel:'instagram'}),/Campaign not found/);
});
test('saved and uncertain idea results are reused without another paid request',async()=>{
 for(const status of ['succeeded','queued','unknown']){const f=fixture({id:'old',status,output:{plan:{slots:[{hook:'Idea',brief:'Approved topic',pillar:'Education'}]}}});const r=await f.service.generate('user',brand,plan,{format:'static',channel:'instagram',refresh:status==='unknown'},'request-key');assert.equal(r.id,'old');assert.equal(f.submitted.length,0);assert.ok(f.queries.every(q=>q.args[0]==='tenant'&&q.args[1]===brand));}
 assert.deepEqual(ideaResponse({id:'failed',status:'failed',output:{plan:{slots:[{}]}}}).ideas,[]);
});
test('new idea jobs request only bounded concepts with brand/feedback restrictions, not video rendering',async()=>{
 const f=fixture(null);await f.service.generate('user',brand,plan,{format:'reel',channel:'instagram'},'request-key');const args=f.submitted[0];assert.equal(args[2].reference_plan_id,plan);assert.equal(args[2].post_count,3);assert.equal(args[2].video_count,0);assert.match(args[2].brief,/UNTRUSTED contextual data/);assert.match(args[2].brief,/Do not invent engagement, likes/);assert.deepEqual(args[5],{plan_id:plan,format:'reel',channel:'instagram'});
});
test('durable suggestion worker persists ideas without creating campaigns, slots or images',async()=>{
 const snapshot={facts:[{id:'fact',field:'offering',value:'Garden products'}]},sha=hash(canonicalJSON(snapshot));
 const input={task:'content_plan',post_ideas:{plan_id:plan,format:'static',channel:'instagram'},brand:{id:'brain',sha256:sha,facts:snapshot.facts},preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['instagram'],must_avoid:'',revision:1},brief:'Ideas',post_count:3,duration_days:7,video_count:0};
 const output={type:'result',version:'deepagents-0.7.29/desvio-plan-v1',plan:generatedPlan(input),skills:Object.entries(PLANNING_SKILLS).map(([name,pin])=>({name,...pin})),reads:Object.keys(PLANNING_SKILLS).map(s=>`/skills/${s}/SKILL.md`),model_calls:1,helpers_executed:false};
 const request={input,input_sha256:hash(canonicalJSON(input)),brain_id:'brain',provider:'openai',selected_model:'TEST',scheduled_at:'2020-01-01',output};
 const writes=[],job={id:'job',kind:'plan.generate',status:'queued',organization_id:'tenant',brand_id:brand};
 const db={query:async(sql,args)=>{if(sql.startsWith('SELECT * FROM app.planning_requests'))return {rows:[request]};if(sql.includes('FROM app.brand_brain_versions'))return {rows:[{id:'brain',sha256:sha,snapshot}]};if(sql.includes('SELECT model FROM'))return {rows:[{model:'TEST'}]};writes.push({sql,args});return {rows:[]};}};
 const jobs={transaction:async(_,fn)=>fn(db,job),permitted:async()=>true};
 assert.equal(await new PlanningJobs(jobs,{configured:true},{configured:true}).run({}),'succeeded');
 assert.ok(writes.some(q=>q.sql.startsWith('UPDATE app.jobs')&&q.args[1]==='succeeded'));assert.ok(writes.every(q=>!q.sql.includes('INSERT INTO')));
});
