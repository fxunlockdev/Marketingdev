import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const origin=process.env.DESVIO_UI_BASE;
test('composer suggestions preserve the draft and stay dismissed', {skip:!origin,timeout:90000},async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:920}});
 const brand='11111111-1111-4111-8111-111111111111',business={id:brand,organization_id:brand,name:'Courtyard Studio',role:'owner',has_approved_brand:true};
 let dismissed=false,sends=0,lookups=0;
 await page.route('**/api/**',async r=>{
  const u=new URL(r.request().url()).pathname;let data={};
  if(u.endsWith('/get-session'))data={user:{id:'one',name:'Owner',emailVerified:true}};
  else if(u==='/api/v1/businesses')data={businesses:[business]};
  else if(u.endsWith('/overview'))data={counts:{},upcoming_posts:[],activity:[],recommendations:[],generation_activity:[],campaigns:[],performance:{available_count:0,published_count:0,items:[],posts:[]},next_actions:[]};
  else if(u.endsWith('/outbox')){if(r.request().method()==='PUT')sends++;data={request:null};}
  else if(u.endsWith('/history'))data={conversations:[]};
  else if(u.endsWith('/generation-notifications'))data={notifications:[]};
  else if(u.endsWith('/dismiss')){dismissed=true;}
  else if(u.endsWith('/prompt-suggestions')){
   if(r.request().method()==='POST'){lookups++;data={id:null,status:'succeeded',idea:{title:'The first light arrives',direction:'Follow the farm path into the morning light.'}};}
   else data={context:'Residential real estate',preference_key:'user-brand',dismissed};
  }
  await r.fulfill({json:data});
 });
 try{
  const url=origin+'/b/'+brand;
  await page.goto(url+'/create?start=video');
  const input=page.getByRole('textbox',{name:'Message Desvio'}),region=page.getByRole('region',{name:'Prompt ideas'});
  await expect(region.getByRole('button',{name:/architectural reveal/i})).toBeVisible();
  const brief='Create a mountain farm stay video for young families';
  const latency=await input.evaluate(async(el,brief)=>{
   const start=performance.now();
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,brief);
   el.dispatchEvent(new Event('input',{bubbles:true}));
   while(![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Arriving at the farm stay'))){
    if(performance.now()-start>3000)throw Error('No match');await new Promise(requestAnimationFrame);
   }return performance.now()-start;
  },brief);
  await region.getByRole('button',{name:/Arriving/}).hover();
  await expect(region.getByText(/Open low beside/)).toBeVisible();
  mkdirSync('work/browser',{recursive:true});
  await page.screenshot({path:'work/browser/prompt-ideas-preview.png'});
  await expect(input).toHaveValue(brief);assert.equal(sends,0);
  await region.getByRole('button',{name:'Insert',exact:true}).click();
  await expect(input).toHaveValue(/young families\nOpen low beside/);await expect(input).toBeFocused();assert.equal(sends,0);
  await page.reload();await input.fill(brief);
  await expect(region.getByRole('button',{name:/The first light arrives/})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await region.getByRole('button',{name:/The first light arrives/}).click();
  await region.getByRole('button',{name:'Cancel',exact:true}).click();await expect(input).toHaveValue(brief);
  await input.fill('restaurant');await expect(region).toHaveCount(0);
  await page.goto(url+'/overview');await expect(page.getByRole('textbox',{name:'Ask Desvio'})).toBeVisible();await expect(region).toHaveCount(0);assert(dismissed);
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.getByRole('textbox',{name:'Ask Desvio'})).toBeVisible();await expect(region).toHaveCount(0);
  assert(lookups>0);assert.equal(sends,0);console.log('Local keyword to visible choice (ms)',latency);
 }finally{await browser.close();}
});
