import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
const origin=process.env.DESVIO_UI_BASE;
test('MOCK API: dashboard priorities and saved questionnaire work at desktop, tablet and phone sizes',{skip:!origin,timeout:90000},async()=>{
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const id='11111111-1111-4111-8111-111111111111';
 const business={id,organization_id:id,name:'Courtyard Studio',website:null,role:'owner',has_approved_brand:false};
 let failSave=false;
 let saved={revision:0,step:0,brief:{offering:'',audience:'',market:'',goal:'awareness',visual_direction:'',must_follow:''},research_job_id:null};
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[business]};
  else if(path.endsWith('/assets'))data={assets:[]};
  else if(path.endsWith('/canvas/references'))data={references:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/overview'))data={counts:{awaiting_review:2,approved_posts:1,creative_projects:3,active_jobs:1,published_posts:0,scheduled_posts:0,uncertain_publications:0,publication_attention:0,failed_jobs_last_week:0},upcoming_posts:[{id,channel:'instagram',format:'carousel',hook:'Meet the people behind the courtyard',brief:'',state:'content_needed',planned_at:'2026-11-20T09:00:00Z',timezone:'Asia/Kuala_Lumpur',starts_on:'2026-11-20',plan_title:'Local stories',design:null,generation_status:null}],campaigns:[],activity:[],recommendations:[],generation_activity:[],performance:{published_count:0,available_count:0,posts:[]}};
  else if(path.endsWith('/guided-brief')){
   if(request.method()==='PATCH'){if(failSave){await route.fulfill({status:503,json:{message:'Save unavailable'}});return;}const input=request.postDataJSON();assert.equal(input.revision,saved.revision);saved={...saved,...input,revision:saved.revision+1};}
   data=saved;
  }
  else if(path.endsWith('/guided-brief/research')){saved={...saved,research_job_id:id,status:'queued'};data={id,status:'queued'};}
  await route.fulfill({json:data});
 });
 try{
  const evidence=process.env.DESVIO_UI_EVIDENCE;
  if(evidence)await mkdir(evidence,{recursive:true});
  await expect(page.getByRole('region',{name:'Starter post ideas'})).toContainText('A place to meet');
  await expect(page.getByRole('region',{name:'Starter post ideas'})).toContainText('An everyday ritual');
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});await page.goto(`${origin}/b/${id}/overview`);
   await expect(page.getByRole('heading',{name:'Your attention'})).toBeVisible();
   if(width===1440){await expect(page.getByRole('link',{name:'Home',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toHaveCount(0);await expect(page.locator('.header-create')).toBeVisible();}
   await expect(page.getByRole('link',{name:/2 posts to review/})).toBeVisible();
   await expect(page.getByRole('link',{name:'Plan my content',exact:false})).toHaveAttribute('href',`/b/${id}/monthly-planning`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const contrast=await new AxeBuilder({page}).withRules(['color-contrast']).analyze();assert.deepEqual(contrast.violations.map(v=>v.nodes.map(n=>n.target)),[]);
   if(evidence)await page.screenshot({path:`${evidence}/dashboard-${width}.png`,fullPage:true});
  }
  await page.goto(`${origin}/b/${id}/monthly-planning`);
  await expect(page.getByRole('heading',{name:'Tell us about your business'})).toBeVisible();
  await page.getByLabel('What does your business do?').fill('A neighbourhood cafe serving seasonal food.');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Who are we creating for?'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Who are we creating for?'})).toBeVisible();
  await page.getByLabel('Your priority audience', {exact:true}).fill('Local families');
  failSave=true;
  await page.getByRole('button',{name:'Save for later',exact:true}).click();
  await expect(page.locator('.notice.error[role="alert"]')).toContainText('We couldn’t save or load your work');
  await expect(page.getByLabel('Your priority audience', {exact:true})).toHaveValue('Local families');
  assert.ok(page.url().endsWith('/monthly-planning'));
  failSave=false;
  await page.getByRole('button',{name:'Save for later',exact:true}).click();
  await expect(page).toHaveURL(`${origin}/b/${id}/overview`);
  assert.equal(saved.brief.audience,'Local families');assert.equal(saved.step,1);
  await page.goto(`${origin}/brands`);
  const resume=page.getByRole('link',{name:'Continue setup',exact:false});
  await expect(resume).toHaveAttribute('href',`/b/${id}/guided-onboarding`);
  await resume.click();
  await expect(page.getByLabel('Your priority audience', {exact:true})).toHaveValue('Local families');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pick a look you love'})).toBeVisible();
  await page.getByRole('button',{name:'Cinematic Editorial',exact:true}).click();
  await page.getByRole('button',{name:'Enlarge Cinematic Editorial'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Enlarge Cinematic Editorial'})).toBeFocused();
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(evidence)await page.screenshot({path:`${evidence}/questionnaire-${width}.png`,fullPage:true});
  }
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
  assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Send my brief',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Learning about your business'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Back',exact:true})).toBeDisabled();
  await page.reload();await expect(page.getByRole('heading',{name:'Learning about your business'})).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('MOCK API: mood board revision, approval and campaign setup remain usable across screen sizes',{skip:!origin,timeout:90000},async()=>{
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),id='11111111-1111-4111-8111-111111111111';
 const direction={summary:'A welcoming neighbourhood cafe',rationale:'Natural light and honest food.',palette:[{role:'primary',hex:'#244536'},{role:'secondary',hex:'#FAF7EF'},{role:'accent',hex:'#B96135'}],heading_font:'Lora',body_font:'DM Sans',voice:'Warm and welcoming',imagery:'Everyday cafe moments in natural light',pillars:['Community','Seasonal food'],starter_ideas:[{format:'static',title:'A place to meet',concept:'A welcoming cafe table in natural light.'},{format:'carousel',title:'An everyday ritual',concept:'Arrival, coffee, and a shared table.'}],essential_questions:[]};
 const business={id,organization_id:id,name:'Courtyard Studio',website:null,role:'owner',has_approved_brand:true};
 let boards=[],campaigns=[],submissions=0;
 const preview={width:1024,height:1024,background_media_id:id,layers:[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.includes('/creative-media/')){await route.fulfill({contentType:'image/webp',body:await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#244536"/><circle cx="700" cy="300" r="220" fill="#B96135"/><text x="80" y="800" fill="#FAF7EF" font-size="80">Fixture preview</text></svg>')).webp().toBuffer()});return;}
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[business]};
  else if(path.endsWith('/canvas/references'))data={references:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/guided-brief'))data={revision:1,step:4,brief:{offering:'Cafe',audience:'Families',market:'Mumbai',goal:'awareness',visual_direction:'Natural',must_follow:''},research_job_id:id,status:'succeeded',result:{business_direction:direction}};
  else if(path.endsWith('/brain'))data={active:{id},findings:[],revision:1};
  else if(path.endsWith('/moodboards')){
   if(req.method()==='POST'){const input=req.postDataJSON();if(boards.length){assert.equal(input.feedback,'More everyday moments');assert.equal(input.style.palette[0].hex,'#123456');assert.deepEqual(Object.keys(input.style).sort(),['body_font','heading_font','palette']);}boards.push({id:`board-${boards.length}`,status:'ready',direction,image_status:'succeeded',carousel_status:'succeeded',design:preview,slides:[{design:preview},{design:preview},{design:preview}]});data={id:boards.at(-1).id};}
   else data={boards,allowance:{items:{static:{remaining:20},carousel:{remaining:5},video:{remaining:5}}}};
  }else if(path.endsWith('/approve')){boards.at(-1).status='locked';data={id:boards.at(-1).id,status:'locked'};}
  else if(path.endsWith('/guided-campaigns')){
   if(req.method()==='POST'){submissions++;assert.equal(req.postDataJSON().static_count,5);assert.equal(req.postDataJSON().carousel_count,1);campaigns=[{id,planning_status:'queued'}];data={id};}
   else data={channels:['instagram'],campaigns};
  }
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/guided-onboarding`);
  await page.getByRole('button',{name:'Create my mood board'}).click();
  await expect(page.getByRole('heading',{name:'Your brand, brought together.'})).toBeVisible();
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
   await page.locator('figcaption').last().scrollIntoViewIfNeeded();await expect(page.locator('figure svg image')).toHaveCount(4);
   if(process.env.DESVIO_UI_EVIDENCE)await page.screenshot({path:`${process.env.DESVIO_UI_EVIDENCE}/moodboard-${width}.png`,fullPage:true});
  }
  await page.getByText('Adjust colours and fonts',{exact:true}).click();
  await page.getByLabel('primary colour',{exact:true}).fill('#123456');
  await page.getByLabel('What would you change?').fill('More everyday moments');
  await page.getByRole('button',{name:'Revise mood board'}).click();
  await expect(page.getByRole('button',{name:'Revise mood board'})).toHaveCount(0);
  await page.goto(`${origin}/b/${id}/monthly-planning`);
  await expect(page.getByRole('button',{name:'Prepare my content plan'})).toHaveCount(0);
  await page.getByRole('button',{name:'Approve this direction'}).click();
  await expect(page.getByRole('heading',{name:'Let’s plan your content'})).toBeVisible();
  await page.goto(`${origin}/b/${id}/monthly-planning`);
  await expect(page.getByRole('heading',{name:'Plan my content',exact:true})).toBeVisible();
  await expect(page.getByText('Your business answers',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Your brand, brought together.'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'View my approved direction'})).toHaveAttribute('href',`/b/${id}/guided-onboarding`);
  for(const width of [1440,768,390]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(process.env.DESVIO_UI_EVIDENCE){await mkdir(process.env.DESVIO_UI_EVIDENCE,{recursive:true});await page.screenshot({path:`${process.env.DESVIO_UI_EVIDENCE}/monthly-planning-${width}.png`,fullPage:true});}
  }
  await page.getByRole('checkbox',{name:'instagram'}).check();
  await page.getByRole('button',{name:'Prepare my content plan'}).click();
  await expect(page.getByRole('heading',{name:'Planning your content'})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Planning your content'})).toBeVisible();assert.equal(submissions,1);
  campaigns=[{id,output_plan_id:id,planning_status:'succeeded',plan_approved_at:null,generation_started_at:null,slots:[{id,revision:1,brief:'Seasonal cafe stories',channel:'instagram',format:'static',planned_at:'2026-12-01T09:00:00Z'}]}];
  await page.reload();await expect(page.getByRole('link',{name:'Review my calendar'})).toHaveAttribute('href',`/b/${id}/content-plan?plan=${id}`);
  await expect(page.getByRole('button',{name:'Approve plan & create posts'})).toHaveCount(0);
  campaigns[0]={...campaigns[0],generation_started_at:'2026-11-10T10:00:00Z',total_posts:6,ready_posts:6};
  await page.reload();await page.getByRole('button',{name:'Plan more content'}).click();
  await expect(page.getByRole('heading',{name:'Let’s plan your content'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create my mood board'})).toHaveCount(0);
  await page.getByRole('button',{name:'Back to current plan'}).click();
  await expect(page.getByRole('heading',{name:'Your monthly content is ready to review'})).toBeVisible();
 }finally{await browser.close();}
});

test('MOCK API: repeated research requires resolving alternative facts before approval',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage(),id='11111111-1111-4111-8111-111111111111';
 const findings=[{id:'a',field:'audience',value:'Local families',status:'correct',revision:1},{id:'b',field:'audience',value:'Local neighbours',status:'correct',revision:1},{id:'name',field:'brand_name',value:'Cafe',status:'correct',revision:1},{id:'offer',field:'offering',value:'Coffee',status:'correct',revision:1}];let approved=false;
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id,organization_id:id,name:'Cafe',role:'owner'}]};
  else if(path.endsWith('/canvas/references'))data={references:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/guided-brief'))data={revision:1,step:4,brief:{offering:'Cafe',audience:'Families',market:'Mumbai',goal:'awareness',visual_direction:'Natural',must_follow:''},research_job_id:id,status:'succeeded',result:{business_direction:{summary:'Cafe',essential_questions:[],palette:[],pillars:[]}}};
  else if(path.endsWith('/brain'))data={active:approved?{id}:null,findings,revision:1};
  else if(path.includes('/findings/')){findings.find(f=>path.endsWith(f.id)).status=req.postDataJSON().decision;}
  else if(path.endsWith('/approve')){assert.equal(findings.filter(f=>f.status==='correct').length,3);approved=true;}
  else if(path.endsWith('/moodboards'))data={boards:[],allowance:{items:{static:{remaining:20},carousel:{remaining:5},video:{remaining:5}}}};
  else if(path.endsWith('/guided-campaigns'))data={channels:['instagram'],campaigns:[]};
  await route.fulfill({json:data});
 });
 try{await page.goto(`${origin}/b/${id}/guided-onboarding`);await expect(page.getByRole('button',{name:'Confirm business details'})).toBeDisabled();await expect(page.getByRole('status')).toContainText('alternative descriptions');await page.getByRole('checkbox',{name:'Leave this detail out'}).nth(1).check();await page.getByRole('button',{name:'Confirm business details'}).click();await expect(page.getByRole('button',{name:'Create my mood board'})).toBeVisible();assert.equal(approved,true);}finally{await browser.close();}
});

test('MOCK API: Calendar reviews the exact plan and starts assets only after approval',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),id='11111111-1111-4111-8111-111111111111';
 const slot={id,revision:7,brief:'Meet the cafe team',channel:'instagram',format:'static',planned_at:'2026-12-01T09:00:00Z'};
 const plan={id,output_plan_id:id,planning_status:'succeeded',generation_started_at:null,plan_approved_at:null,slots:[slot]};let approvals=0;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id,organization_id:id,name:'Cafe',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/canvas/references'))data={references:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/guided-campaigns'))data={campaigns:[plan],channels:['instagram']};
  else if(path.endsWith('/approve')){assert.deepEqual(req.postDataJSON(),{slots:[{id,revision:7}],video_references:[]});approvals++;plan.plan_approved_at='2026-11-10T00:00:00Z';}
  else if(path.endsWith('/onboarding'))data={timezone:'Asia/Kuala_Lumpur',step:3};
  else if(path.endsWith('/overview'))data={upcoming_posts:[]};
  else if(path.endsWith('/content-plan/jobs'))data={jobs:[]};
  else if(path.endsWith('/content-plan'))data={slots:[],total:0,has_more:false};
  await route.fulfill({json:data});
 });
 try{
  await page.clock.install();
  await page.goto(`${origin}/b/${id}/content-plan?plan=${id}`);
  await expect(page.getByRole('heading',{name:'Review your concepts and calendar'})).toBeVisible();
  await expect(page.getByText('Meet the cafe team',{exact:true})).toBeVisible();assert.equal(approvals,0);
  await expect(page.locator('.calendar-page-heading').getByRole('link',{name:'Plan my content'})).toHaveAttribute('href',`/b/${id}/monthly-planning`);
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.getByRole('button',{name:'Approve calendar & generate assets'}).click();
  await expect(page.getByText(/Plan approved. We’re preparing your assets/)).toBeVisible();assert.equal(approvals,1);
  // An edit before asset submission invalidates the approval on the server.
  plan.plan_approved_at=null;slot.revision=8;slot.brief='Updated cafe story';
  await page.clock.fastForward(16000);
  await expect(page.getByText('Updated cafe story',{exact:true})).toBeVisible();
  await expect(page.getByText(/Plan approved. We’re preparing your assets/)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Approve calendar & generate assets'})).toBeEnabled();
  assert.equal(approvals,1,'Changed topics require another explicit approval');
  plan.plan_approved_at='2026-11-10T00:00:00Z';
  await page.reload();await expect(page.getByRole('button',{name:'Approve calendar & generate assets'})).toHaveCount(0);
  await expect(page.getByText('Calendar approved. Asset generation is starting…')).toBeVisible();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('MOCK API: calendar video image choice is included in the explicit approval',{skip:!origin,timeout:60000},async()=>{
 const {createHash}=await import('node:crypto');
 const photo=await sharp({create:{width:80,height:80,channels:3,background:'#b7cbbb'}}).jpeg().toBuffer(),sha=createHash('sha256').update(photo).digest('hex');
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),id='11111111-1111-4111-8111-111111111111';
 let submitted;const slot={id,revision:4,brief:'Show our courtyard in morning light',channel:'instagram',format:'video',planned_at:'2026-12-01T09:00:00Z'};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id,organization_id:id,name:'Cafe',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/guided-campaigns'))data={campaigns:[{id,planning_status:'succeeded',plan_approved_at:submitted?'2026-11-10T00:00:00Z':null,slots:[slot]}]};
  else if(path.endsWith('/canvas/references'))data={references:[{id,visual_id:id,label:'Courtyard photo',sha256:sha,width:80,height:80,kind:'upload',crop:null}]};
  else if(path.includes('/visuals/'))data={url:`${origin}/api/fixture-photo`,bytes:photo.length,sha256:sha};
  else if(path.endsWith('/fixture-photo')){await route.fulfill({body:photo,contentType:'image/jpeg'});return;}
  else if(path.endsWith('/approve'))submitted=req.postDataJSON();
  else if(path.endsWith('/onboarding'))data={timezone:'UTC',step:3};
  else if(path.endsWith('/overview'))data={upcoming_posts:[]};
  else if(path.endsWith('/content-plan/jobs'))data={jobs:[]};
  else if(path.endsWith('/content-plan'))data={slots:[],total:0,has_more:false};
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/content-plan?plan=${id}`);
  const select=page.getByRole('combobox',{name:'Starting image'});await select.click();
  await page.getByRole('option',{name:'Courtyard photo',exact:true}).click();
  await expect(page.getByAltText('Selected video starting image')).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(submitted,undefined);
  await page.getByRole('button',{name:'Approve calendar & generate assets'}).click();
  await expect(page.getByText(/Plan approved. We’re preparing your assets/)).toBeVisible();
  assert.deepEqual(submitted,{slots:[{id,revision:4}],video_references:[{id,reference:{brand_reference_id:id,source_sha256:sha,confirmed:true}}]});
 }finally{await browser.close();}
});

test('MOCK API: missing research facts can be supplied and explicitly confirmed without leaving onboarding',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage(),id='11111111-1111-4111-8111-111111111111';
 const findings=[];let approved=false,adds=0,loseReply=true;const keys=new Map();
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id,organization_id:id,name:'Cafe',role:'owner'}]};
  else if(path.endsWith('/canvas/references'))data={references:[]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/guided-brief'))data={revision:1,step:4,brief:{offering:'Seasonal coffee',audience:'Local families',market:'Mumbai',goal:'awareness',visual_direction:'Natural',must_follow:''},research_job_id:id,status:'succeeded',result:{business_direction:{summary:'Cafe',essential_questions:[],palette:[],pillars:[]}}};
  else if(path.endsWith('/brain'))data={active:approved?{id}:null,findings,revision:findings.length+1};
  else if(path.endsWith('/findings')){
   const body=req.postDataJSON(),key=req.headers()['idempotency-key'];assert.ok(key);assert.equal(approved,false);
   if(!keys.has(key)){data={id:`fact-${adds++}`,field:body.field,value:body.value,status:'unreviewed',revision:1};findings.push(data);keys.set(key,data);}else data=keys.get(key);
   if(loseReply){loseReply=false;await route.abort();return;}
  }else if(path.includes('/findings/')){const f=findings.find(f=>path.endsWith(f.id));assert.equal(req.postDataJSON().revision,f.revision);f.status=req.postDataJSON().decision;f.revision++;}
  else if(path.endsWith('/approve')){assert.equal(findings.length,3);assert.ok(findings.every(f=>f.status==='correct'));approved=true;}
  else if(path.endsWith('/moodboards'))data={boards:[],allowance:{items:{static:{remaining:20},carousel:{remaining:5},video:{remaining:5}}}};
  else if(path.endsWith('/guided-campaigns'))data={channels:['instagram'],campaigns:[]};
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/guided-onboarding`);
  await expect(page.getByRole('button',{name:'Confirm business details'})).toBeDisabled();
  await expect(page.getByLabel('What you offer',{exact:true})).toHaveValue('Seasonal coffee');
  await page.getByLabel('Who you serve',{exact:true}).fill('Neighbourhood families');
  await page.getByRole('button',{name:'Save missing details'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'Save missing details'}).click();
  await expect(page.getByRole('button',{name:'Confirm business details'})).toBeEnabled();
  assert.equal(adds,3);assert.equal(approved,false);assert.equal(findings.find(f=>f.field==='audience').value,'Neighbourhood families');
  await page.getByRole('button',{name:'Confirm business details'}).click();
  await expect(page.getByRole('button',{name:'Create my mood board'})).toBeVisible();assert.equal(approved,true);
  await page.reload();await expect(page.getByRole('button',{name:'Create my mood board'})).toBeVisible();
 }finally{await browser.close();}
});

test('MOCK API: failed website research continues inline with saved answers',{skip:!origin,timeout:30000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage(),id='11111111-1111-4111-8111-111111111111';
 const business={id,organization_id:id,name:'Courtyard Studio',website:'https://example.com',role:'owner',has_approved_brand:false};
 let submissions=0;
 let saved={revision:1,step:4,brief:{offering:'Cafe',audience:'Local families',market:'Mumbai',goal:'awareness',visual_direction:'Warm',must_follow:''},research_job_id:id,status:'failed',can_use_saved_answers:true};
 await page.route('**/api/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[business]};
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  else if(path.endsWith('/guided-brief')){if(r.method()==='PATCH')assert.deepEqual(r.postDataJSON().brief,saved.brief);data=saved;}
  else if(path.endsWith('/guided-brief/research')){assert.deepEqual(r.postDataJSON(),{revision:1,use_saved_answers:true});assert.ok(r.headers()['idempotency-key']);submissions++;saved={...saved,status:'queued',can_use_saved_answers:false};data={id,status:'queued'};}
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/guided-onboarding`);
  await expect(page.getByRole('heading',{name:'Research didn’t finish'})).toBeVisible();
  await page.getByRole('button',{name:'Continue with my answers',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Learning about your business'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continue with my answers',exact:true})).toHaveCount(0);
  assert.equal(submissions,1);assert.ok(page.url().endsWith('/guided-onboarding'));
  await page.reload();await expect(page.getByRole('heading',{name:'Learning about your business'})).toBeVisible();assert.equal(submissions,1);
 }finally{await browser.close();}
});

test('MOCK API: uncertain website capture stays visible and reconciles without resubmitting',{skip:!origin,timeout:30000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();
 const id='11111111-1111-4111-8111-111111111111';
 const business={id,organization_id:id,name:'Courtyard Studio',website:'https://example.com',role:'owner',has_approved_brand:false};
 let writes=[],reads=0;
 let saved={revision:1,step:4,brief:{offering:'Family cafe',audience:'Local families',market:'Mumbai',goal:'awareness',visual_direction:'Warm',must_follow:''},research_job_id:id,status:'unknown',analysis_status:'queued',can_use_saved_answers:false};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.startsWith('/api/v1/businesses/')&&!['GET','HEAD'].includes(req.method()))writes.push(path);
  if(path.endsWith('/get-session'))data={user:{id:'fixture',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[business]};
  else if(path.endsWith('/guided-brief')){reads++;data=saved;}
  else if(path.endsWith('/generation-notifications'))data={notifications:[]};
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${id}/guided-onboarding`);
  await expect(page.getByRole('heading',{name:'Your research needs a check'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Learning about your business'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Send my brief'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Continue with my answers'})).toHaveCount(0);
  saved={...saved,status:'failed',analysis_status:'canceled',can_use_saved_answers:true};
  await expect(page.getByRole('button',{name:'Continue with my answers'})).toBeVisible({timeout:12000});
  await expect(page.getByRole('heading',{name:'Your research needs a check'})).toHaveCount(0);
  assert.ok(reads>=2);assert.deepEqual(writes,[],'Reconciliation must never submit another provider request');
 }finally{await browser.close();}
});
