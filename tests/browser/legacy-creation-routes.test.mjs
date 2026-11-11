import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE;
test('MOCK API: old Canvas and Campaigns links resolve to current customer workflows',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch();
 const page=await browser.newPage();
 const id='11111111-1111-4111-8111-111111111111',errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data={};
  if(path.endsWith('/get-session'))data={user:{id,name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id,organization_id:id,name:'Courtyard Studio',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/create-chat/history'))data={conversations:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/onboarding'))data={timezone:'Asia/Kuala_Lumpur',channels:['instagram']};
  else if(path.endsWith('/content-plan'))data={slots:[],total:0,has_more:false};
  else if(path.endsWith('/content-plan/jobs'))data={jobs:[]};
  else if(path.endsWith('/guided-campaigns'))data={campaigns:[]};
  else if(path.endsWith('/canvas/references'))data={references:[]};
  else if(path.endsWith('/content-plans'))data={plans:[]};
  else if(path.endsWith('/content-slots'))data={slots:[]};
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/canvas`);
  await expect(page).toHaveURL(`${origin}/b/${id}/create`);
  await expect(page.getByLabel('Message Desvio',{exact:true})).toBeEnabled();
  await expect(page.getByRole('heading',{name:/Your idea lands/})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Business unavailable'})).toHaveCount(0);
  await page.goto(`${origin}/b/${id}/campaigns`);
  await expect(page.getByRole('heading',{name:'Business unavailable'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Calendar',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Calendar',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Today',exact:true})).toBeEnabled();
  await expect(page.getByRole('link',{name:'Campaigns',exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
