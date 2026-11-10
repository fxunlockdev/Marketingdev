import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdirSync} from 'node:fs';
const origin=process.env.DESVIO_UI_BASE,brand='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
async function setup(){
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),writes=[];
 const businesses=[{id:brand,organization_id:brand,name:'Courtyard Studio',role:'owner',has_approved_brand:true},{id:other,organization_id:brand,name:'Garden House',role:'admin'}];
 let prefs={revision:1,step:3,goal:'awareness',timezone:'UTC',cadence:3,channels:['instagram'],must_avoid:'',business_stage:'established',growth_expectation:''};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'owner',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses};
  else if(path.endsWith('/team'))data={members:[],invitations:[],activity:[],can_manage:true,can_assign_admin:true,can_manage_account:true};
  else if(path.endsWith('/onboarding')){if(req.method()==='PATCH'){writes.push(req.postDataJSON());prefs={...prefs,...req.postDataJSON()};}data=prefs;}
  else if(path.endsWith('/invitations')&&req.method()==='POST'){writes.push(req.postDataJSON());await new Promise(r=>setTimeout(r,250));data={id:'mock-invite'};}
  await route.fulfill({json:data});
 });
 return {browser,page,writes,close:async()=>{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}};
}

test('creative brief can be selected, refined, saved and reopened on desktop and mobile (fixture API)',{skip:!origin,timeout:90000},async()=>{
 const f=await setup(),{page,writes}=f;
 try{
  await page.goto(`${origin}/b/${brand}/content-preferences`);
  await page.getByText('Your creative brief',{exact:false}).click();
  await page.getByLabel('Which markets do you want to reach?').fill('Mumbai and Thane');
  await page.getByLabel('Which languages should your content use?').fill('English');
  await page.getByLabel('Any launch dates or timing to keep in mind?').fill('December launch');
  await page.getByRole('combobox',{name:'Explore a creative direction'}).click();
  await page.getByRole('option',{name:'Quiet Ritual',exact:true}).click();
  await expect(page.getByAltText('Quiet Ritual style inspiration')).toBeVisible();
  await expect.poll(()=>page.getByAltText('Quiet Ritual style inspiration').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  mkdirSync('work/onboarding-review',{recursive:true});
  await page.locator('.creative-direction-preview').screenshot({path:'work/onboarding-review/style-preview.png'});
  await expect(page.getByLabel('Describe or refine your visual direction')).toContainText('Quiet Ritual');
  await page.getByLabel('Describe or refine your visual direction').fill('Warm daylight and quiet spaces');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();
  await expect.poll(()=>writes.length).toBe(1);
  assert.deepEqual(writes[0].creative_brief,{markets:'Mumbai and Thane',languages:'English',timing:'December launch',direction:'Warm daylight and quiet spaces'});
  await page.reload();await page.getByText('Your creative brief',{exact:false}).click();
  await expect(page.getByLabel('Which markets do you want to reach?')).toHaveValue('Mumbai and Thane');
  await expect(page.getByLabel('Describe or refine your visual direction')).toHaveValue('Warm daylight and quiet spaces');
  const axe=await new AxeBuilder({page}).include('.creative-brief').analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);
  mkdirSync('work/onboarding-review',{recursive:true});
  await page.locator('.creative-brief').screenshot({path:'work/onboarding-review/creative-brief-desktop.png'});
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   assert(await page.locator('.creative-brief').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await page.locator('.creative-brief').screenshot({path:`work/onboarding-review/creative-brief-${width}.png`});
  }
 }finally{await f.close();}
});
