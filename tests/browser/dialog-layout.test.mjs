import {selectOption as choose} from './select-control.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE;
const brand='11111111-1111-4111-8111-111111111111',plan='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),submitted=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id:brand,organization_id:brand,name:'Courtyard Studio',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/content-plans'))data={plans:[{id:plan,title:'Courtyard Studio: Inspiring life in the city’s finest residences, gardens and neighbourhoods',starts_on:new Date().toISOString().slice(0,10),duration_days:30,timezone:'UTC'}]};
  else if(path.endsWith('/ideas'))data={id:'idea',status:'succeeded',ideas:[{title:'Room to grow',topic:'A welcoming residence for young families',angle:'Lifestyle'},{title:'A greener everyday',topic:'Gardens and community spaces',angle:'Nature'},{title:'Thoughtful details',topic:'A closer look at interiors',angle:'Design'}]};
  else if(path.endsWith('/references'))data={references:[]};
  else if(path.includes('/content-plan?')||path.endsWith('/content-plan'))data={slots:[]};
  else if(req.method()==='POST'&&/\/(posts|blogs)$/.test(path)){submitted.push({path,body:req.postDataJSON()});await route.fulfill({status:422,json:{error:'Layout test: submission captured'}});return;}
  await route.fulfill({json:data});
 });
 await page.goto(`${origin}/b/${brand}/campaigns?post=new`);
 const dialog=page.getByRole('dialog',{name:'New Post',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('combobox',{name:'Campaign',exact:true})).toContainText('Courtyard Studio');
 return {browser,page,dialog,submitted,close:async()=>{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}};
}
test('New Post keeps fields, inset arrows and actions usable at desktop, tablet, mobile and short heights',{skip:!origin,timeout:90000},async()=>{
 const f=await fixture(),{page,dialog}=f;
 try{
  for(const size of [{width:1440,height:1000},{width:768,height:800},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
   await page.setViewportSize(size);
   const layout=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),h=el.querySelector('header').getBoundingClientRect(),field=el.querySelector('.campaign-compose-campaign').getBoundingClientRect(),footer=el.querySelector(':scope>footer').getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,footerVisible:footer.bottom<=innerHeight&&footer.top>=h.bottom,horizontalOverflow:el.scrollWidth>el.clientWidth+1,fieldBelowHeading:field.top>=h.bottom,bodyScrollable:el.querySelector('fieldset').clientHeight>30};});
   assert(layout.inside&&layout.footerVisible&&layout.bodyScrollable,JSON.stringify({size,layout}));assert.equal(layout.horizontalOverflow,false); // The header stays separate while the body scrolls.
   await dialog.getByRole('combobox',{name:'Campaign',exact:true}).scrollIntoViewIfNeeded();
   assert(await dialog.getByRole('combobox',{name:'Campaign',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),icon=el.querySelector('.ds-select-chevron').getBoundingClientRect();return r.right-icon.right>=12;}));
   await dialog.getByRole('button',{name:'Posting on',exact:true}).click();
   const date=page.getByRole('dialog',{name:'Posting on',exact:true});await expect(date).toBeVisible();
   const box=await date.boundingBox();assert(box.x>=0&&box.x+box.width<=size.width+1&&box.y>=0&&box.y+box.height<=size.height+1);
   assert(await date.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Date content must fit its dialog');
   const closeBox=await date.getByRole('button',{name:'Close date picker'}).boundingBox();assert(closeBox.width>=40&&closeBox.height>=40);
   await date.getByLabel('Hour',{exact:true}).fill('25');await date.getByRole('button',{name:'Use date & time'}).click();await expect(date.getByRole('alert')).toBeVisible();
   await date.getByLabel('Hour',{exact:true}).fill('14');await date.getByLabel('Minute',{exact:true}).fill('30');await date.getByRole('button',{name:'Use date & time'}).click();await expect(date).toHaveCount(0);await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Posting on',exact:true})).toContainText('14:30');
   await dialog.getByRole('button',{name:'Posting on',exact:true}).click();await page.keyboard.press('Escape');await expect(date).toHaveCount(0);await expect(dialog).toBeVisible();
  }
  assert.equal(f.submitted.length,0);
 }finally{await f.close();}
});
test('expanded context, typography, reference picker and format changes preserve the submitted brief',{skip:!origin,timeout:90000},async()=>{
 const f=await fixture(),{page,dialog,submitted}=f;
 try{
  await dialog.getByRole('button',{name:'Room to grow',exact:false}).click();await expect(dialog.getByLabel('Topic',{exact:true})).toHaveValue('A welcoming residence for young families');
  await dialog.getByRole('button',{name:'Add context'}).click();await dialog.getByLabel('Creative direction',{exact:false}).fill('Warm light and natural camera movement');
  await dialog.getByRole('button',{name:'Media library',exact:true}).click();await expect(dialog.getByText('No approved images yet. Upload your first image above.')).toBeVisible();
  await dialog.locator('summary').filter({hasText:'Image text & fonts'}).click();await choose(dialog.getByRole('combobox',{name:'Font direction',exact:true}),'custom');await choose(dialog.getByRole('combobox',{name:'Title font',exact:true}),'Lora');
  for(const format of ['static','carousel','story','reel','video','blog']){
   await choose(dialog.getByRole('combobox',{name:'Post format',exact:true}),format);
   if(format==='carousel')await dialog.getByLabel('Slides',{exact:false}).fill('5');
   if(format!=='blog')await choose(dialog.getByRole('combobox',{name:'Channel',exact:true}),'facebook');
   await dialog.getByRole('button',{name:'Create Post',exact:true}).click();await expect.poll(()=>submitted.length).toBe(['static','carousel','story','reel','video','blog'].indexOf(format)+1);
   const {body}=submitted.at(-1);assert.equal(body.brief,'A welcoming residence for young families');assert.equal(body.context,'Warm light and natural camera movement');assert(body.planned_at);
   if(format==='blog'){assert(!('creative_spec' in body));assert(!('channel' in body));}
   else{assert.equal(body.channel,'facebook');assert.equal(body.creative_spec.placement,format==='reel'?'reel':format==='story'?'story':'feed');if(['static','carousel','story'].includes(format))assert.equal(body.creative_spec.artwork.typography.headline.family,'Lora');if(format==='carousel')assert.equal(body.creative_spec.slide_count,5);}
   await expect(dialog.getByRole('button',{name:'Create Post',exact:true})).toBeEnabled();
  }
 }finally{await f.close();}
});
