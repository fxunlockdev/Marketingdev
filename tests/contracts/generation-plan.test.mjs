import test from 'node:test';import assert from 'node:assert/strict';
import {campaignMonthDays,generationPlanMix} from '../../dist/generation-plan.js';
test('monthly mix scales across configured plans and the middle plan supports daily images plus five videos',()=>{
 assert.deepEqual(generationPlanMix(800),{image_posts:30,video_posts:5,daily_images:true});assert.ok(generationPlanMix(500).video_posts<5);assert.ok(generationPlanMix(1000).video_posts>5);assert.ok(generationPlanMix(1000).image_posts>30);assert.throws(()=>generationPlanMix(799));
});
test('calendar-month lengths handle leap years, short months and year boundaries',()=>{
 for(const [date,days] of [['2026-01-01',31],['2026-02-01',28],['2028-02-01',29],['2026-04-01',30],['2026-12-01',31],['2026-01-31',28],['2028-01-31',29],['2026-10-25',31]])assert.equal(campaignMonthDays(date),days,date);
 for(const date of ['','not a date','2026-02-30','2026-13-01','2026-1-1'])assert.throws(()=>campaignMonthDays(date));
});
