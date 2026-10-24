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
