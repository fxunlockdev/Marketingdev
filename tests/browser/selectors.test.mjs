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
async function fits(page){await expect(page.locator('.ds-select-popup[data-open]')).toBeVisible();assert(await page.locator('.ds-select-popup[data-open]').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}));}
const output=process.env.DESVIO_SCREENSHOT_DIR;
async function shot(page,name){if(output){await page.waitForTimeout(180);mkdirSync(output,{recursive:true});await page.screenshot({path:`${output}/${name}.png`});}}
test('single roles and multiple business access use the same surface without changing permissions or payloads',{skip:!origin,timeout:90000},async()=>{
 const f=await setup(),{page,writes}=f;
 try{
  await page.goto(`${origin}/b/${brand}/team`);
  const role=page.getByRole('combobox',{name:'Business role',exact:true}),access=page.getByRole('combobox',{name:'Businesses they can access',exact:true});
  await role.click();await expect(page.getByRole('listbox')).toBeVisible();assert.equal(await page.locator('.ds-select-checkbox').count(),0);await fits(page);await shot(page,'single-role-desktop');
  await page.getByRole('option',{name:'Reviewer · approve or request changes',exact:true}).click();await expect(page.getByRole('listbox')).toHaveCount(0);await expect(role).toBeFocused();await expect(role).toContainText('Reviewer');
  await role.press('ArrowDown');await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Escape');await expect(role).toBeFocused();
  await access.click();await expect(page.getByRole('listbox')).toHaveAttribute('aria-multiselectable','true');
  const locked=page.getByRole('option',{name:'Courtyard Studio (this business)',exact:true});await expect(locked).toHaveAttribute('aria-disabled','true');await expect(locked).toHaveAttribute('aria-selected','true');
  await page.getByRole('option',{name:'Garden House',exact:true}).click();await expect(page.getByRole('listbox')).toBeVisible();await expect(access).toContainText('2 selected');await shot(page,'multiple-businesses-desktop');
  const axe=await new AxeBuilder({page}).include('.ds-select-popup').analyze();assert.deepEqual(axe.violations.map(v=>({id:v.id,description:v.description})),[]);
  await page.keyboard.press('Escape');await expect(access).toBeFocused();
  await page.getByLabel('Teammate’s email').fill('layout-test@example.test');await page.getByRole('button',{name:'Send invitation',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);assert.equal(writes[0].role,'reviewer');assert.deepEqual(writes[0].business_ids,[brand,other]);
  for(const width of [768,390,320]){
   await page.setViewportSize({width,height:844});await expect(access).toBeEnabled();await access.click();await fits(page);await shot(page,`multiple-businesses-${width}`);await page.keyboard.press('Escape');await expect(access).toBeFocused();
  }
 }finally{await f.close();}
});
test('preferences support checkbox toggles, searchable city aliases, Escape and saved values',{skip:!origin,timeout:90000},async()=>{
 const f=await setup(),{page,writes}=f;
 try{
  await page.goto(`${origin}/b/${brand}/content-preferences`);
  const channels=page.getByRole('combobox',{name:'Preferred channels',exact:true});await channels.click();
  await page.getByRole('option',{name:'LinkedIn',exact:true}).click();await expect(channels).toContainText('2 selected');
  assert.equal(await page.getByRole('option',{name:'Facebook',exact:true}).locator('.ds-select-checkbox > span').evaluate(el=>getComputedStyle(el).visibility),'hidden');await page.getByRole('option',{name:'Instagram',exact:true}).click();await expect(channels).toContainText('1 selected');await expect(page.getByRole('option',{name:'Instagram',exact:true})).toHaveAttribute('aria-selected','false');
  await page.keyboard.press('Escape');await expect(channels).toBeFocused();
  const goal=page.getByRole('combobox',{name:'Primary goal',exact:true});await goal.focus();await goal.press('ArrowDown');await expect(page.getByRole('option',{name:'Build awareness',exact:true})).toBeFocused();await page.keyboard.press('End');await expect(page.getByRole('option',{name:'Grow sales',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(goal).toContainText('Grow sales');
  const zone=page.getByRole('combobox',{name:'Time zone',exact:true});await zone.click();
  const search=page.getByRole('combobox',{name:'Search cities or time zones'});await search.fill('Mumbai');await expect(page.getByRole('option')).toHaveCount(1);await fits(page);await shot(page,'time-zone-search');await search.press('ArrowDown');await search.press('Enter');await expect(zone).toContainText('Kolkata');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);assert.deepEqual(writes[0].channels,['linkedin']);assert.equal(writes[0].goal,'sales');assert.equal(writes[0].timezone,'Asia/Kolkata');
  await page.reload();await expect(channels).toContainText('1 selected');await expect(goal).toContainText('Grow sales');await expect(zone).toContainText('Kolkata');
  await page.setViewportSize({width:390,height:844});await zone.click();await page.getByRole('combobox',{name:'Search cities or time zones'}).fill('nothing matches here');await expect(page.getByText('No matching city. Try a nearby major city.')).toBeVisible();await fits(page);await page.keyboard.press('Escape');await expect(zone).toBeFocused();
  await page.emulateMedia({reducedMotion:'reduce'});await channels.click();await expect(page.locator('.ds-select-popup[data-open]')).toBeVisible();assert(await page.locator('.ds-select-popup[data-open]').evaluate(el=>getComputedStyle(el).transitionDuration.split(',').every(duration=>parseFloat(duration)<=0.001)));await page.keyboard.press('Escape');
 }finally{await f.close();}
});
