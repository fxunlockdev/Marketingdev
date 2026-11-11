import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scheduleGeneratedPlan,validateGeneratedPlan,coverageOffsets} from '../../dist/planning-contracts.js';
import {planHorizon} from '../../dist/planning-schema.js';
import {planTime} from '../../dist/content-plan.js';
import {localMinute,addDays} from '../../dist/local-calendar.js';
import {generatedPlan} from '../fixtures/planning.mjs';

const input={task:'content_plan',brand:{id:'brain',sha256:'0'.repeat(64),facts:[{id:'offering',field:'offering',value:'Scheduling tools'}]},preferences:{starts_on:'2026-11-01',timezone:'UTC',goal:'awareness',cadence:3,channels:['linkedin','instagram'],must_avoid:'Unsupported claims',revision:1},brief:'Brand-specific plan',post_count:30};
const withoutDates=plan=>plan.slots.map(({planned_at,...slot})=>slot);
const formats=plan=>plan.slots.reduce((counts,slot)=>({...counts,[slot.format]:(counts[slot.format]??0)+1}),{});
const weeksOf=(plan,context)=>new Set(plan.slots.map(slot=>Math.floor((Date.parse(localMinute(slot.planned_at,context.preferences.timezone).slice(0,10))-Date.parse(context.preferences.starts_on))/86400000/7)));

test('M2: a sparse month whose last week has two or three days is redated instead of rejected',()=>{
 for(const [days,count] of [[30,5],[31,5],[29,5],[30,6],[31,7],[23,4],[16,3]]){
  for(const max_posts_per_day of [undefined,2]){
   const context={...structuredClone(input),duration_days:days,post_count:count,...(max_posts_per_day?{max_posts_per_day}:{})};
   const plan=generatedPlan(context);
   // The fixture spaces posts evenly, which leaves the short final week empty.
   assert.throws(()=>validateGeneratedPlan(plan,context),/PLAN_OUTPUT_INVALID/,`${days}/${count} should start uncovered`);
   const fixed=scheduleGeneratedPlan(plan,context);
   assert.equal(validateGeneratedPlan(fixed,context),fixed);
   assert.equal(weeksOf(fixed,context).size,Math.min(count,Math.ceil(days/7)));
   assert.deepEqual(withoutDates(fixed),withoutDates(plan),'only dates may change');
   assert.deepEqual(scheduleGeneratedPlan(fixed,context),fixed,'a repaired plan is stable on replay');
  }
 }
});

test('M2: repair keeps the number of posts per format and the model’s order',()=>{
 const context={...structuredClone(input),duration_days:30,post_count:6,video_count:2};
 const plan=generatedPlan(context);plan.slots.forEach((slot,i)=>slot.planned_at=`2026-11-0${i+1}T09:00:00Z`);
 const fixed=scheduleGeneratedPlan(plan,context);
 assert.deepEqual(formats(fixed),formats(plan));assert.deepEqual(formats(fixed),{video:2,static:4});
 assert.deepEqual(fixed.slots.map(s=>s.hook),plan.slots.map(s=>s.hook));
 assert.ok(fixed.slots.every((slot,i)=>i===0||slot.planned_at>=fixed.slots[i-1].planned_at));
 assert.ok(fixed.warnings.some(w=>/every week/.test(w)));
 const invented=structuredClone(plan);invented.slots[0].fact_ids=['invented'];
 assert.throws(()=>scheduleGeneratedPlan(invented,context),/PLAN_OUTPUT_INVALID/,'repair never hides unsupported claims');
});

test('M2: every supported horizon and count can be placed, within the daily ceiling',()=>{
 for(let days=1;days<=90;days++){
  for(const perDay of [undefined,1,2]){
   for(const count of new Set([1,2,Math.ceil(days/7),Math.ceil(days/7)+1,days,Math.min(90,days*(perDay??2))])){
    if(count>90||count<1||(perDay&&count>days*perDay))continue;
    const offsets=coverageOffsets(count,days,perDay);
    assert.equal(offsets.length,count);assert.ok(offsets.every(o=>Number.isInteger(o)&&o>=0&&o<days),`${days}/${count}`);
    assert.deepEqual([...offsets].sort((a,b)=>a-b),offsets);
    assert.equal(new Set(offsets.map(o=>Math.floor(o/7))).size,Math.min(count,Math.ceil(days/7)),`${days}/${count}/${perDay}`);
    if(perDay){const daily=new Map();for(const o of offsets)daily.set(o,(daily.get(o)??0)+1);assert.ok([...daily.values()].every(n=>n<=perDay));}
   }
  }
 }
});

test('M2: repaired dates stay on the right local day across daylight-saving changes',()=>{
 for(const [starts_on,days,timezone] of [['2026-03-01',31,'America/New_York'],['2026-10-20',30,'Europe/London'],['2026-09-20',30,'Australia/Lord_Howe'],['2028-02-01',29,'Asia/Kolkata']]){
  const context={...structuredClone(input),duration_days:days,post_count:5,max_posts_per_day:2};Object.assign(context.preferences,{starts_on,timezone});
  const plan=generatedPlan(context),fixed=scheduleGeneratedPlan(plan,context);
  const local=fixed.slots.map(slot=>localMinute(slot.planned_at,timezone));
  assert.ok(local.every(minute=>minute.slice(0,10)>=starts_on&&minute.slice(0,10)<addDays(starts_on,days)),timezone);
  assert.ok(local.every(minute=>['10:00','15:00'].includes(minute.slice(11))),timezone);
  assert.equal(weeksOf(fixed,context).size,5);
 }
});

test('week, month and custom durations map to exact local-date ranges',()=>{
 for(const [duration,starts_on,days,ends_on] of [['week','2026-11-12',7,'2026-11-18'],['month','2028-02-01',29,'2028-02-29'],['month','2027-02-01',28,'2027-02-28'],['month','2026-04-10',30,'2026-05-09'],['month','2026-12-01',31,'2026-12-31'],['month','2027-01-31',28,'2027-02-27'],[10,'2026-12-28',10,'2027-01-06'],[1,'2026-11-12',1,'2026-11-12'],[90,'2026-11-12',90,'2027-02-09']]){
  const horizon=planHorizon(duration,starts_on,'UTC');
  assert.equal(horizon.duration_days,days,`${duration} from ${starts_on}`);assert.equal(horizon.ends_on,ends_on);assert.equal(horizon.starts_on,starts_on);
  assert.equal(horizon.start,`${starts_on}T00:00:00.000Z`);assert.equal(horizon.end,`${addDays(ends_on,1)}T00:00:00.000Z`);
 }
 for(const bad of [['fortnight','2026-11-12','UTC'],[0,'2026-11-12','UTC'],[91,'2026-11-12','UTC'],[1.5,'2026-11-12','UTC'],['week','2026-02-30','UTC'],['week','12/11/2026','UTC'],['week','2026-11-12','Mars/Olympus']])assert.throws(()=>planHorizon(...bad),/PLAN_HORIZON_INVALID/);
});

test('local ranges absorb daylight-saving shifts and agree with slot validation',()=>{
 const cases=[
  ['month','2026-03-01','America/New_York','2026-03-01T05:00:00.000Z','2026-04-01T04:00:00.000Z',31*24-1],
  ['week','2026-10-20','Europe/London','2026-10-19T23:00:00.000Z','2026-10-27T00:00:00.000Z',7*24+1],
  ['month','2026-11-01','America/Los_Angeles','2026-11-01T07:00:00.000Z','2026-12-01T08:00:00.000Z',30*24+1],
  [14,'2026-04-01','Pacific/Auckland','2026-03-31T11:00:00.000Z','2026-04-14T12:00:00.000Z',14*24+1],
  ['week','2026-11-12','Asia/Kolkata','2026-11-11T18:30:00.000Z','2026-11-18T18:30:00.000Z',7*24],
 ];
 for(const [duration,starts_on,timezone,start,end,hours] of cases){
  const horizon=planHorizon(duration,starts_on,timezone);
  assert.equal(horizon.start,start,timezone);assert.equal(horizon.end,end,timezone);assert.equal((Date.parse(end)-Date.parse(start))/3600000,hours);
  const minute=ms=>new Date(ms).toISOString();
  assert.equal(planTime(minute(Date.parse(start)),starts_on,timezone,horizon.duration_days),start);
  assert.ok(planTime(minute(Date.parse(end)-60000),starts_on,timezone,horizon.duration_days));
  assert.throws(()=>planTime(minute(Date.parse(end)),starts_on,timezone,horizon.duration_days));
  assert.throws(()=>planTime(minute(Date.parse(start)-60000),starts_on,timezone,horizon.duration_days));
 }
});
