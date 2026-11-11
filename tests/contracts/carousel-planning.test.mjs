import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateCarouselInput,validateCarouselPlan,validateCarouselResult,carouselSlideBrief,CAROUSEL_SKILLS} from '../../dist/carousel-planning.js';
import {carouselInput,carouselPlan} from '../fixtures/carousel-planning.mjs';
const envelope=plan=>({type:'result',version:'deepagents-0.7.29/desvio-carousel-v1',plan,skills:Object.entries(CAROUSEL_SKILLS).map(([name,pin])=>({name,...pin})),reads:Object.keys(CAROUSEL_SKILLS).map(s=>`/skills/${s}/SKILL.md`),model_calls:1,helpers_executed:false});
test('carousel plan binds exact count/order, shared direction and caption, separate alt text and approved evidence',()=>{
 for(const count of [2,3,10]){const input=carouselInput(count),plan=carouselPlan(count);validateCarouselInput(input);assert.equal(validateCarouselPlan(plan,input),plan);assert.equal(validateCarouselResult(envelope(plan),input).plan,plan);for(let i=0;i<count;i++){const brief=carouselSlideBrief(plan,i);assert.equal(brief.caption,plan.caption);assert.deepEqual(brief.palette,plan.palette);assert.ok(brief.image_prompt.includes(plan.visual_direction));assert.ok(brief.image_prompt.includes(`Slide ${i+1} of ${count}`));assert.equal('alt_text' in brief,false);}}
});
test('carousel contract rejects unsupported inputs, missing/extra/repeated slides and invented facts or executable fields',()=>{
 for(const patch of [{slide_count:1},{slide_count:11},{slide_count:2.5},{channel:'unknown'},{task:'content_plan'},{prompt:''},{url:'https://private.example'}])assert.throws(()=>validateCarouselInput({...carouselInput(),...patch}),/CAROUSEL_INPUT_INVALID/);
 for(const mutate of [p=>p.slides.pop(),p=>p.slides.push({...p.slides[0]}),p=>p.slides[0].position=2,p=>p.slides[1]={...p.slides[0],position:2},p=>p.slides[0].fact_ids=['invented'],p=>p.slides[0].fact_ids=['offering','offering'],p=>p.slides[0].alt_text='',p=>p.slides[0].command='curl private',p=>p.palette=['red','blue'],p=>p.visual_direction='',p=>p.slides[0].image_prompt='x'.repeat(3001),p=>p.caption='x'.repeat(3001),p=>p.caption='unsafe\u0000']){const plan=carouselPlan();mutate(plan);assert.throws(()=>validateCarouselPlan(plan,carouselInput()),/CAROUSEL_PLAN_INVALID/);}
 assert.throws(()=>carouselSlideBrief(carouselPlan(),99),/CAROUSEL_SLIDE_MISSING/);
});
test('carousel runtime proof requires exact owner skill digests, read evidence and bounded read-only broker use',()=>{
 for(const mutate of [r=>r.helpers_executed=true,r=>r.model_calls=4,r=>r.version='invented',r=>r.skills.pop(),r=>r.skills[0].skill_sha256='0'.repeat(64),r=>r.reads=[],r=>r.reads.push('/secrets/api-key'),r=>r.reads.push('/skills/image/../secret')]){const r=envelope(carouselPlan());mutate(r);assert.throws(()=>validateCarouselResult(r,carouselInput()),/CAROUSEL_SKILL_OUTPUT_INVALID/);}
});

test('carousel structured output binds approved facts and exact slide count before submission',async()=>{
 const {carouselPlanSchema}=await import('../../dist/carousel-planning.js');
 const {CreativeProvider}=await import('../../dist/creative-provider.js');
 const {SkillRuntime}=await import('../../dist/skill-runtime.js');
 const input=carouselInput(3),request={type:'model',step:3,messages:[{role:'user',content:'Plan the slides'}],tools:[]};
 const runtime=new SkillRuntime();let sent;
 runtime.run=async(_input,model)=>model({...request,carousel_plan_schema:{attacker:true}});
 await runtime.carouselPlan(input,async r=>{sent=r;return {};});
 const schema=carouselPlanSchema(input);
 assert.deepEqual(sent.carousel_plan_schema,schema);
 assert.equal(schema.properties.slides.minItems,3);assert.equal(schema.properties.slides.maxItems,3);
 assert.deepEqual(schema.properties.slides.items.properties.fact_ids.items.enum,input.brand.facts.map(f=>f.id));
 const pattern=new RegExp(schema.properties.slides.items.properties.body.pattern);
 assert(pattern.test('Line one\nLine two'));assert(!pattern.test('a'.repeat(501)));
 let options;
 const provider=new CreativeProvider(undefined,{responses:{create:async(body,opts)=>{options=opts;assert.equal(body.text.format.strict,true);assert.deepEqual(body.text.format.schema,schema);return {status:'completed',output:[],output_text:JSON.stringify(carouselPlan(3)),id:'fixture',usage:{}};}}});
 await provider.plan(sent,'gpt-6.1-sol',16000);assert.equal(options.timeout,120000);
 await provider.plan({...sent,step:1},'gpt-6.1-sol',16000);assert.equal(options.timeout,60000);
 // Runtime validation remains authoritative for order and duplicate slides.
 const invalid=carouselPlan(3);invalid.slides[1].position=1;
 assert.throws(()=>validateCarouselPlan(invalid,input),/CAROUSEL_PLAN_INVALID/);
});
