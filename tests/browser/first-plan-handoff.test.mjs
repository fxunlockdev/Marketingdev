import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE;
test('MOCK API: manual brand setup saves before the guided creative direction and never generates a legacy plan',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();
 page.on('pageerror',e=>console.error(e.message));
 const id='11111111-1111-4111-8111-111111111111';
 const business={id,organization_id:id,name:'Courtyard Studio',role:'owner',website:null};
 let fail=true,generated=0,approved=0,saved=0;
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id,name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[business]};
  else if(path.endsWith('/onboarding')){
   if(request.method()==='PATCH'){saved++;if(fail){await route.fulfill({status:503,json:{message:'unavailable'}});return;}}
   data={revision:1,step:3,goal:'awareness',cadence:3,timezone:'UTC',channels:['instagram'],must_avoid:''};
  }else if(path.endsWith('/brain/approve')){approved++;data={};}
  else if(path.endsWith('/brain'))data={revision:1,findings:[],visuals:{directions:[]}};
  else if(path.endsWith('/content-plan/generate')){generated++;data={id,status:'queued'};}
  else if(path.endsWith('/guided-brief'))data={revision:0,step:0,brief:{}};
  else if(path.endsWith('/intake'))data={jobs:[],sources:[],images:[]};
  else if(path.endsWith('/assets'))data={assets:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/jobs'))data={jobs:[]};
  else if(path.endsWith('/sources'))data={sources:[]};
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/onboarding`);
  const next=page.getByRole('button',{name:'Continue to my creative direction',exact:true});
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('.notice.error').first()).toBeVisible();
  assert.equal(approved,0);assert.equal(generated,0);
  await expect(page).toHaveURL(`${origin}/b/${id}/onboarding`);
  fail=false;await next.click();
  await expect(page).toHaveURL(`${origin}/b/${id}/guided-onboarding`);
  assert.equal(saved,2);assert.equal(approved,1);assert.equal(generated,0);
 }finally{await browser.close();}
});
