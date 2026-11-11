import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE;
test('MOCK API: uncertain image recovery requires confirmation, survives failure and never resubmits generation',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}});
 const brand='11111111-1111-4111-8111-111111111111',conversation='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333';
 let status='unknown',attempts=0,fail=true;const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(req.method()==='POST'&&path!=='/api/v1/accounts/current/initialize')writes.push(path);
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id:brand,organization_id:brand,name:'Studio',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/outbox'))data={request:null};
  else if(path.includes('/history'))data={conversations:[]};
  else if(path.endsWith('/create-chat/conversations/'+conversation))data={conversation:{id:conversation,title:'Courtyard'},turns:[{id:'turn',message:'Create a courtyard image',status:'succeeded',action_status:'succeeded',output:{action:'image',reply:'Preparing your image.',prompt:'Courtyard',channel:'instagram',size:'1024x1024'},action_result:{id:job}}],saved_images:[],carousel_runs:[],carousel_slides:[]};
  else if(path.endsWith('/canvas/threads/'+conversation))data={thread:{id:conversation},runs:[{id:job,status,created_at:new Date().toISOString(),error_code:status==='canceled'?'CREATIVE_RESULT_ABANDONED':null}],projects:[],planning_runs:[]};
  else if(path.endsWith('/videos'))data={configured:true,projects:[],runs:[],versions:[]};
  else if(path.endsWith('/stop-waiting')){
   attempts++;assert.deepEqual(req.postDataJSON(),{acknowledge_possible_charge:true});
   if(fail){await route.fulfill({status:409,json:{message:'Still reconciling. Try again shortly.'}});return;}
   status='canceled';data={id:job,status,automatically_retried:false};
  }
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${brand}/create?conversation=${conversation}`);
  await page.getByRole('button',{name:'Stop waiting',exact:true}).click();
  await expect(page.getByText(/provider may still charge/)).toBeVisible();assert.equal(attempts,0);
  await page.getByRole('button',{name:'Keep waiting',exact:true}).click();assert.equal(attempts,0);
  await page.getByRole('button',{name:'Stop waiting',exact:true}).click();
  await page.getByRole('button',{name:'Stop waiting for this request',exact:true}).click();
  await expect(page.locator('.creative-recovery').getByRole('alert')).toContainText('Still reconciling');assert.equal(attempts,1);
  fail=false;await page.getByRole('button',{name:'Stop waiting for this request',exact:true}).click();
  await expect(page.getByRole('button',{name:'Stop waiting',exact:true})).toHaveCount(0);
  await page.reload();await expect(page.getByRole('button',{name:'Stop waiting',exact:true})).toHaveCount(0);
  assert.equal(attempts,2);assert.equal(writes.length,2,JSON.stringify(writes));assert.ok(writes.every(p=>p.endsWith('/stop-waiting')));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('MOCK API: stopped carousel offers an explicit quoted replacement, unknown result does not',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();
 const id='11111111-1111-4111-8111-111111111111',job='33333333-3333-4333-8333-333333333333';let status='unknown',submitted=0;
 const slot={id,plan_id:id,revision:1,format:'carousel',state:'content_needed',brief:'Courtyard stories',pillar:'Community',hook:'Hello',cta:'Visit',planned_at:'2026-12-01T09:00:00Z',timezone:'UTC',plan_title:'Monthly content',reference_ids:[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id,organization_id:id,name:'Studio',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/content-slots/'+id))data={slot,generations:[],videos:[],carousel_runs:[{id:job,status}],carousel_slides:[],events:[]};
  else if(path.endsWith('/image-batch'))data={jobs:[{id:job,slot_id:id,status}],quote:{available:true,slots:[{id,revision:1,credits:123}]}};
  else if(path.endsWith('/generate-images')){submitted++;assert.deepEqual(req.postDataJSON(),{slots:[{id,revision:1}],credit_cap:123});status='queued';data={jobs:[{id:job,slot_id:id,status}]};}
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/campaign-post?slot=${id}`);
  await expect(page.getByRole('button',{name:'Continue · create 1 post',exact:true})).toHaveCount(0);assert.equal(submitted,0);
  status='canceled';await page.reload();
  await expect(page.getByRole('button',{name:'Continue · create 1 post',exact:true})).toBeEnabled();assert.equal(submitted,0);
  await page.getByRole('button',{name:'Continue · create 1 post',exact:true}).click();
  await expect.poll(()=>submitted).toBe(1);await expect(page.getByRole('button',{name:'Continue · create 1 post',exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});
