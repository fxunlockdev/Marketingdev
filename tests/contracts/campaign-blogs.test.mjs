import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CampaignBlogs} from '../../dist/campaign-blogs.js';
import {BLOG_SKILLS,BLOG_VERSION,blogSchema,validateBlogInput,validateBlogResult} from '../../dist/blog-contracts.js';
import {JobDispatcher} from '../../dist/jobs.js';

const skills=Object.entries(BLOG_SKILLS).map(([name,pin])=>({name,...pin}));
const result=(over={})=>({type:'result',version:BLOG_VERSION,article:{title:'A practical guide',body:'# A practical guide\n\nUseful grounded advice.',warnings:[]},skills,
 reads:['/.agents/product-marketing.md',...skills.map(s=>`/skills/${s.name}/SKILL.md`)],model_calls:2,helpers_executed:false,...over});
const input=(over={})=>({task:'blog',brand:{facts:[{id:'f1',field:'offering',value:'Doorstep grooming'}]},topic:'Teach readers',context:'',...over});

test('a harness article is accepted only with pinned skills, safe reads and a bounded article',()=>{
 assert.deepEqual(validateBlogResult(result()).article,{title:'A practical guide',body:'# A practical guide\n\nUseful grounded advice.',warnings:[]});
 const rejects=value=>assert.throws(()=>validateBlogResult(value),/SKILL_/);
 rejects(result({version:'deepagents-0.7.29/desvio-creative-v1'}));
 rejects(result({skills:skills.map(s=>s.name==='copywriting'?{...s,tree_sha256:'0'.repeat(64)}:s)}));
 rejects(result({skills:skills.filter(s=>s.name!=='content-strategy')}));
 rejects(result({reads:[...result().reads,'/skills/../secrets.md']}));
 rejects(result({model_calls:4}));rejects(result({helpers_executed:true}));rejects(result({extra:true}));
 rejects(result({article:{title:'Two\nlines',body:'x',warnings:[]}}));
 rejects(result({article:{title:'T',body:'Hello <script>alert(1)</script>',warnings:[]}}));
 rejects(result({article:{title:'T',body:'a'.repeat(40001),warnings:[]}}));
 rejects(result({article:{title:'T',body:'x',warnings:[],status:'approved'}}));
});

test('the harness request is exact and the output schema is strict',()=>{
 validateBlogInput(input());validateBlogInput(input({current_article:{title:'Old',body:'Old body'}}));
 for(const bad of [input({task:'creative'}),input({topic:''}),input({context:'x'.repeat(1801)}),input({extra:1}),input({brand:{facts:[{id:'f1',field:'offering'}]}}),input({current_article:{title:'Old'}})])
  assert.throws(()=>validateBlogInput(bad),/SKILL_INPUT_INVALID/);
 const schema=blogSchema();assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['title','body','warnings']);
});

test('blog malformed revisions and request keys are rejected before database work',async()=>{
 let accessed=false;const service=new CampaignBlogs({scope:()=>{accessed=true;throw new Error('unexpected');}});
 for(const revision of [undefined,0,-1,1.5,2147483647])await assert.rejects(service.generate('u','b','i',{revision},'valid-key'));
 await assert.rejects(service.generate('u','b','i',{revision:1},'short'));assert.equal(accessed,false);
});

test('blog monthly credit exhaustion is clear',async()=>{
 const service=new CampaignBlogs({scope:async()=>{throw {code:'P0001',message:'MONTHLY_GENERATION_BUDGET_EXHAUSTED'};}});
 await assert.rejects(service.generate('u','b','i',{revision:1},'valid-key'),/monthly generation credit limit/);
});

test('the API holds no model client for articles; the worker runs blog.generate',async()=>{
 for(const file of ['campaign-blogs','app'])assert.doesNotMatch(readFileSync(new URL(`../../dist/${file}.js`,import.meta.url),'utf8'),/from 'openai'|creative-provider|openaiApiKey/);
 const started=[],pool={query:async sql=>sql.startsWith('UPDATE app.job_dispatch SET lease_id')?{rows:[{job_id:'j',organization_id:'o',brand_id:'b',kind:'blog.generate'}]}:{rows:[]}};
 const client={workflow:{start:async(name,options)=>{started.push([name,options.workflowId]);}}};
 assert.equal(await new JobDispatcher(pool,client,'desvio').runOnce(),true);
 assert.deepEqual(started,[['generateBlogWorkflow','desvio-blog-j']]);
});
