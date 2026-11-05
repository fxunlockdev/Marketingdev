import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const origin=process.env.DESVIO_UI_BASE;
test('composer suggestions preserve the draft and stay dismissed', {skip:!origin,timeout:90000},async()=>{
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:920}});
 const brand='11111111-1111-4111-8111-111111111111',business={id:brand,organization_id:brand,name:'Courtyard Studio',role:'owner',has_approved_brand:true};
 let dismissed=false,sends=0,lookups=0,releaseAI,sentMessage;
 const slowAI=new Promise(resolve=>{releaseAI=resolve;});
 await page.route('**/api/**',async r=>{
  const u=new URL(r.request().url()).pathname;let data={};
  if(u.endsWith('/get-session'))data={user:{id:'one',name:'Owner',emailVerified:true}};
  else if(u==='/api/v1/businesses')data={businesses:[business]};
  else if(u.endsWith('/overview'))data={counts:{},upcoming_posts:[],activity:[],recommendations:[],generation_activity:[],campaigns:[],performance:{available_count:0,published_count:0,items:[],posts:[]},next_actions:[]};
  else if(u.endsWith('/outbox')){if(r.request().method()==='PUT')sends++;data={request:null};}
  else if(u.endsWith('/create-chat/messages')){sentMessage=r.request().postDataJSON().message;data={conversation_id:'22222222-2222-4222-8222-222222222222',id:'33333333-3333-4333-8333-333333333333'};}
  else if(u.endsWith('/history'))data={conversations:[]};
  else if(u.endsWith('/generation-notifications'))data={notifications:[]};
  else if(u.endsWith('/dismiss')){dismissed=true;}
  else if(u.endsWith('/prompt-suggestions')){
   if(r.request().method()==='POST'){lookups++;if(lookups===1)await slowAI;data=lookups===2?{id:null,status:'cooldown',idea:null}:{id:null,status:'succeeded',idea:{title:'The first light arrives',direction:'Follow the farm path into the morning light.'}};}
   else data={context:'Residential real estate',preference_key:'user-brand',dismissed};
  }
  await r.fulfill({json:data});
 });
 try{
  const url=origin+'/b/'+brand;
  await page.goto(url+'/overview');
  const home=page.getByRole('textbox',{name:'Ask Desvio'});
  const ideas=page.getByRole('region',{name:'Prompt ideas'});
  await expect(home).toBeVisible();await expect(ideas).toHaveCount(0);
  await home.fill('Make a video for the cafe');
  await page.getByRole('button',{name:/The first pour/}).hover();
  await home.fill('   ');await expect(ideas).toHaveCount(0);
  await home.fill('Make a video for the cafe');
  await expect(ideas.getByRole('button',{name:'Insert',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/The first pour/}).hover();
  await page.getByRole('button',{name:'Insert',exact:true}).click();
  await expect(home).toHaveValue(/cafe Hold close on the espresso/);
  assert(new URL(page.url()).pathname.endsWith('/overview'));
  await page.goto(url+'/create?start=video');
  const input=page.getByRole('textbox',{name:'Message Desvio'}),region=page.getByRole('region',{name:'Prompt ideas'});
  await expect(input).toBeEnabled();await expect(region).toHaveCount(0);
  await input.fill('Create a video');await page.waitForTimeout(800);await expect(region).toHaveCount(0);assert.equal(lookups,0);
  const brief='Create a mountain farm stay video for young families';
  const latency=await input.evaluate(async(el,brief)=>{
   const start=performance.now();
   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,brief);
   el.dispatchEvent(new Event('input',{bubbles:true}));
   while(![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Arriving at the farm stay'))){
    if(performance.now()-start>3000)throw Error('No match');await new Promise(requestAnimationFrame);
   }return performance.now()-start;
  },brief);
  await expect.poll(()=>lookups).toBe(1);
  await region.getByRole('button',{name:/Arriving/}).hover();
  const settled=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/prompt-suggestions'));
  releaseAI();await settled;
  await expect(region.getByText(/Open low beside/)).toBeVisible();
  mkdirSync('work/browser',{recursive:true});
  await page.screenshot({path:'work/browser/prompt-ideas-preview.png'});
  await expect(input).toHaveValue(brief);assert.equal(sends,0);
  await region.getByRole('button',{name:'Insert',exact:true}).click();
  await expect(input).toHaveValue(/young families\nOpen low beside/);await expect(input).toBeFocused();assert.equal(sends,0);
  const inserted=await input.inputValue();
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect.poll(()=>sentMessage).toBe('Create a video.\n'+inserted);
  assert.equal(sends,1);
  await page.goto(url+'/create?start=video');await input.fill(brief);
  await expect(region.getByRole('button',{name:/The first light arrives/})).toBeVisible({timeout:17000});
  await page.setViewportSize({width:390,height:844});await region.getByRole('button',{name:/The first light arrives/}).click();
  await region.getByRole('button',{name:'Cancel',exact:true}).click();await expect(input).toHaveValue(brief);
  await input.fill('restaurant');await expect(region).toHaveCount(0);
  await page.goto(url+'/overview');await expect(page.getByRole('textbox',{name:'Ask Desvio'})).toBeVisible();await expect(region).toHaveCount(0);assert(dismissed);
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.getByRole('textbox',{name:'Ask Desvio'})).toBeVisible();await expect(region).toHaveCount(0);
  assert(lookups>0);assert.equal(sends,1);console.log('Local keyword to visible choice (ms)',latency);
 }finally{await browser.close();}
});
