import {test} from 'node:test';
import {mkdirSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';import {writeFileSync} from 'node:fs';
const origin=process.env.DESVIO_UI_BASE;
test('canvas image and video progress stays truthful through waiting and recovery (mock API)',{skip:!origin,timeout:180000},async()=>{
mkdirSync('work/browser',{recursive:true});
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const brand='11111111-1111-4111-8111-111111111111',conversation='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',project='44444444-4444-4444-8444-444444444444';
let kind='video',stage=1,status='running',progress=null,cancel=false,disconnected=false,timing={min_seconds:540,max_seconds:1080},created=new Date(Date.now()-120000).toISOString();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;if(disconnected&&(path.endsWith('/videos')||path.endsWith('/canvas/threads/'+conversation))){await route.abort('failed');return;}
 const run={id:job,status,created_at:created,project_id:project,cancel_requested:cancel,provider_phase:stage===2?'completed':stage===1?'accepted':null,provider_progress:progress,brief_ready:stage>0,image_received:stage===2};let data={};
 if(path.endsWith('/get-session'))data={user:{id:'test-user',name:'Sample Owner',emailVerified:true}};
 else if(path==='/api/v1/businesses')data={businesses:[{id:brand,organization_id:brand,name:'Studio',role:'owner',has_approved_brand:true,revision:1}]};
 else if(path.endsWith('/generation-notifications'))data={notifications:[]};
 else if(path.endsWith('/entitlements'))data={plan:'test'};
 else if(path.endsWith('/generation-usage'))data={configured:false};
 else if(path.endsWith('/outbox'))data={request:null};
 else if(path.includes('/history'))data={conversations:[]};
 else if(path.endsWith('/create-chat/conversations/'+conversation))data={conversation:{id:conversation,title:'Media progress'},turns:[{id:'turn',created_at:new Date(Date.now()-3600000).toISOString(),message:'Create a courtyard '+kind,status:'succeeded',action_status:'succeeded',output:{action:kind,reply:'I’ll prepare your courtyard '+kind+'.',prompt:'A peaceful courtyard',channel:'instagram',size:'1024x1024',placement:'feed'},action_result:{id:job}}],saved_images:[],carousel_runs:[],carousel_slides:[]};
 else if(path.endsWith('/canvas/threads/'+conversation))data={thread:{id:conversation},runs:kind==='image'?[run]:[],projects:[],planning_runs:[],image_timing:timing};
 else if(path.endsWith('/videos'))data={configured:true,timing,projects:[{id:project,thread_id:conversation,title:'Your video',created_at:created,latest_version_id:null}],runs:[run],versions:[]};
 await route.fulfill({json:data});});
const report={checked_at:new Date().toISOString(),origin,provider_mode:'UI fixtures only, no provider calls',checks:[],viewports:[]};
try{
 for(const media of ['video','image']){kind=media;stage=1;status='running';progress=null;cancel=false;disconnected=false;created=new Date(Date.now()-120000).toISOString();timing=media==='video'?{min_seconds:540,max_seconds:1080}:{min_seconds:180,max_seconds:300};
  await page.goto(origin+'/b/'+brand+'/create?conversation='+conversation,{waitUntil:'domcontentloaded',timeout:90000});const card=page.getByRole('region',{name:(media==='video'?'Video':'Image')+' generation progress',exact:true});
  await expect(card).toBeVisible({timeout:60000});await expect(card.getByText('Generating your '+media,{exact:true})).toBeVisible();await expect(card.getByText(/Estimated ready/)).toBeVisible();await expect(card.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  const first=await card.locator('.generation-elapsed').innerText();await expect.poll(()=>card.locator('.generation-elapsed').innerText()).not.toBe(first);
  const sweep=card.locator('.generation-sweep');await expect.poll(()=>sweep.evaluate(el=>getComputedStyle(el).animationName)).toBe('generation-sweep-left');
  const direction=await sweep.evaluate(el=>{const frames=el.getAnimations()[0]?.effect?.getKeyframes();return frames?.map(f=>f.transform);});expect(direction?.[0]).toContain('25%');expect(direction?.at(-1)).toContain('-100%');
  await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>sweep.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');await page.emulateMedia({reducedMotion:'no-preference'});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`work/browser/progress-${media}-${width}.png`});report.viewports.push({media,width,overflow:false});}
  await page.setViewportSize({width:1440,height:1000});
  if(media==='video'){progress=.42;await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow','42',{timeout:10000});report.checks.push('real_provider_percentage_only');}
  stage=2;await expect(card.getByText('Saving to your canvas',{exact:true})).toBeVisible({timeout:10000});
  created=new Date(Date.now()-1500000).toISOString();await expect(card.getByText(/Taking longer than estimated/)).toBeVisible({timeout:10000});
  await page.reload();await expect(card.locator('.generation-elapsed')).toHaveText(/2[5-9]:\d\d elapsed/,{timeout:20000});
  disconnected=true;await expect(card.getByText('Reconnecting to progress',{exact:true})).toBeVisible({timeout:10000});await expect(card).not.toHaveClass(/is-animating/);disconnected=false;await expect(card.getByText('Saving to your canvas',{exact:true})).toBeVisible({timeout:10000});
  cancel=true;await expect(card.getByText('Canceling your request',{exact:true})).toBeVisible({timeout:10000});await expect(card).not.toHaveClass(/is-animating/);
  cancel=false;stage=0;timing=null;await expect(card.getByText(/Estimating the wait/)).toBeVisible({timeout:10000});
  status='failed';await expect(card).toHaveCount(0,{timeout:10000});
  report.checks.push(media+': stage updates, elapsed timer, reload persistence, timeout, reconnect, cancellation, failure, insufficient history, reduced motion, right-to-left sweep');
 }
 expect(errors).toEqual([]);report.passed=true;writeFileSync('work/generation-progress-ui.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}

});
