// Drives the customer journey in a real browser against a running local stack:
// sign-up (with the emailed verification link) → sign-in → add a business → five-step
// onboarding → research → mood board → monthly plan with storylines → approve → generated
// images → open a post → approve it. Screenshots go to work/local-shots.
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
import {ROOT,loadSecrets} from './config.mjs';
import {adminPool} from './containers.mjs';
import {mailbox} from './mail-sink.mjs';

const SHOTS=join(ROOT,'work/local-shots');
const LONG=300000;

export async function runJourney(state,{website='https://example.com',headed=false}={}){
 mkdirSync(SHOTS,{recursive:true});
 const base=`http://127.0.0.1:${state.ports.web}`,results=[];
 const browser=await chromium.launch({headless:!headed});
 const page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage();
 page.setDefaultTimeout(30000);
 let n=0;
 const shot=async name=>{const file=join(SHOTS,`${String(++n).padStart(2,'0')}-${name}.png`);await page.screenshot({path:file,fullPage:true});return file;};
 const step=async(name,action)=>{
  const started=Date.now();
  try{const detail=await action();results.push({name,ok:true,seconds:Math.round((Date.now()-started)/1000),detail});process.stdout.write(`PASS ${name}${detail?` — ${detail}`:''}\n`);}
  catch(error){const file=await shot(`failed-${name.replace(/\W+/g,'-')}`).catch(()=>null);results.push({name,ok:false,error:error.message.split('\n')[0],shot:file});process.stdout.write(`FAIL ${name}: ${error.message.split('\n')[0]}\n`);throw error;}
 };
 const email=`journey-${randomBytes(3).toString('hex')}@example.com`,password=randomBytes(15).toString('base64url');
 let businessId,planUrl;
 try{
  await step('sign up and verify email',async()=>{
   const since=Date.now()-1000;
   await page.goto(`${base}/sign-up`);
   await page.getByLabel('Your name').fill('Journey Owner');
   await page.getByLabel('Email address').fill(email);
   await page.getByLabel('Password',{exact:true}).fill(password);
   await page.getByRole('button',{name:'Create account',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Check your inbox'})).toBeVisible();
   await shot('signup-check-inbox');
   let link;
   for(let i=0;i<60&&!link;i++){link=mailbox().findLast(m=>m.to.includes(email)&&Date.parse(m.at)>=since)?.link;if(!link)await sleep(500);}
   if(!link)throw new Error('verification email not received');
   await page.goto(link);
   await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
   return email;
  });
  await step('sign in',async()=>{
   await page.getByLabel('Email address').fill(email);
   await page.getByLabel('Password',{exact:true}).fill(password);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByLabel('Business name')).toBeVisible();
   await shot('add-business');
   // Operator grants (workspace defaults) must exist before the business, as in staging.
   const pool=adminPool({...state,secrets:loadSecrets()},1);
   try{
    for(let i=0;;i++){
     const {rows}=await pool.query('SELECT 1 FROM app.workspace_provider_defaults d JOIN app.personal_accounts p ON p.organization_id=d.organization_id JOIN auth."user" u ON u.id=p.user_id WHERE u.email=$1',[email]);
     if(rows.length)break;
     if(i>60)throw new Error('workspace provider defaults were not applied');
     await sleep(500);
    }
   }finally{await pool.end();}
  });
  await step('add a business with a website',async()=>{
   await page.getByLabel('Business name').fill('Harbour Lane Bakery');
   await page.getByLabel('Website (optional)').fill(website);
   await page.getByRole('button',{name:'Continue'}).click();
   await expect(page).toHaveURL(/\/b\/[0-9a-f-]{36}\/guided-onboarding/);
   businessId=page.url().match(/\/b\/([0-9a-f-]{36})\//)[1];
   return businessId;
  });
  await step('onboarding steps 1–5',async()=>{
   await page.getByLabel('What does your business do?').fill('A neighbourhood bakery selling sourdough, pastries and coffee every morning.');
   await shot('onboarding-1-business');
   await page.getByRole('button',{name:'Continue',exact:true}).click();
   await page.getByLabel('Your priority audience',{exact:true}).fill('Local professionals and families nearby');
   await page.getByLabel('Location or market (optional)').fill('Harbour Lane, Brighton');
   await page.getByLabel('Competitors or similar businesses (up to three, one per line)').fill('Corner Crust Bakery');
   await shot('onboarding-2-customers');
   await page.getByRole('button',{name:'Continue',exact:true}).click();
   await page.getByRole('button',{name:'Quiet Ritual',exact:true}).click();
   await shot('onboarding-3-look');
   await page.getByRole('button',{name:'Continue',exact:true}).click();
   await expect(page.getByText('Step 4 of 5',{exact:false})).toBeVisible();
   await shot('onboarding-4-files');
   await page.getByRole('button',{name:'Continue',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Check your brief'})).toBeVisible();
   await shot('onboarding-5-check');
  });
  await step('send brief; research completes',async()=>{
   await page.getByRole('button',{name:'Send my brief',exact:true}).click();
   await expect(page.getByRole('button',{name:'Confirm business details'})).toBeVisible({timeout:LONG});
   await shot('research-findings');
  });
  await step('review visual directions (workaround: Review sources page)',async()=>{
   // The guided page cannot review visual directions, but approval requires it. See docs/LOCAL_RUN.md.
   await page.goto(`${base}/b/${businessId}/onboarding`);
   await expect(page.getByRole('heading',{name:'Your brand profile'})).toBeVisible();
   await expect(page.getByRole('button',{name:'Confirm details & continue'})).toBeVisible();
   await page.waitForLoadState('networkidle');
   const articles=page.getByRole('article',{name:/^Visual direction:/});
   const count=await articles.count();
   for(let i=0;i<count;i++)await articles.nth(i).getByRole('button',{name:'Correct',exact:true}).click();
   await sleep(1500);
   await page.goto(`${base}/b/${businessId}/guided-onboarding`);
   return `${count} visual direction(s) marked correct`;
  });
  await step('confirm business details',async()=>{
   await page.getByRole('button',{name:'Confirm business details'}).click();
   await expect(page.getByRole('button',{name:'Create my mood board'})).toBeVisible({timeout:60000});
  });
  await step('mood board generated',async()=>{
   await page.getByRole('button',{name:'Create my mood board'}).click();
   await expect(page.getByRole('button',{name:'Approve this direction'})).toBeVisible({timeout:LONG});
   await page.reload();
   await expect(page.getByRole('button',{name:'Approve this direction'})).toBeVisible();
   await expect(page.getByText('Loading preview…')).toHaveCount(0,{timeout:60000});
   await shot('moodboard-ready');
  });
  await step('mood board approved',async()=>{
   await page.getByRole('button',{name:'Approve this direction'}).click();
   await expect(page.getByRole('heading',{name:'Let’s plan your content'})).toBeVisible({timeout:60000});
  });
  await step('monthly plan requested',async()=>{
   await page.getByRole('combobox',{name:'Social platform'}).click();
   await page.getByRole('option',{name:'Instagram',exact:true}).click();
   await page.getByRole('spinbutton',{name:/Static posts/}).fill('3');
   await page.getByRole('spinbutton',{name:/Carousels/}).fill('1');
   await shot('plan-setup');
   await page.getByRole('button',{name:'Prepare my content plan'}).click();
   const review=page.getByRole('link',{name:'Review my calendar'});
   await expect(review).toBeVisible({timeout:LONG});
   planUrl=new URL(await review.getAttribute('href'),base).href;
  });
  await step('plan shown with storylines',async()=>{
   await page.goto(planUrl);
   await expect(page.getByRole('heading',{name:'Review your concepts and calendar'})).toBeVisible();
   const storylines=await page.getByRole('button',{name:'Edit storyline'}).count();
   if(storylines<4)throw new Error(`expected 4 storylines, saw ${storylines}`);
   await shot('plan-storylines');
   return `${storylines} posts with storylines`;
  });
  await step('plan approved; images generated',async()=>{
   await page.getByRole('button',{name:'Approve calendar & generate assets'}).click();
   await sleep(3000);
   // Poll with the page's own refresh control; reloading the whole app repeatedly trips the sign-in rate limit.
   await page.goto(planUrl);
   await page.getByRole('button',{name:'List'}).click();
   for(const deadline=Date.now()+LONG;;){
    await expect(page.getByText('Loading…')).toHaveCount(0,{timeout:30000});
    const ready=await page.getByText('Draft ready').count();
    if(ready>=4)break;
    if(Date.now()>deadline)throw new Error(`only ${ready} of 4 drafts ready`);
    await sleep(15000);
    await page.getByRole('button',{name:'Refresh posts'}).click();
   }
   await expect(page.getByText('Loading…')).toHaveCount(0,{timeout:30000});
   await expect(page.getByText('Draft ready').first()).toBeVisible();
   await shot('calendar-drafts-ready');
   return '4 drafts ready';
  });
  await step('open a post; image visible',async()=>{
   await page.getByRole('button',{name:/Instagram · .* Image/}).first().click();
   await expect(page.getByRole('heading',{name:'Post details'})).toBeVisible();
   // The preview is drawn on a canvas by the editor; require real, non-uniform pixels.
   const canvas=page.getByRole('region',{name:'Creative preview'}).locator('canvas').first();
   await expect(canvas).toBeVisible({timeout:60000});
   await expect.poll(()=>canvas.evaluate(el=>{const c=el.getContext('2d'),d=c.getImageData(0,0,el.width,el.height).data,seen=new Set();for(let i=0;i<d.length;i+=4*997)seen.add(`${d[i]>>4},${d[i+1]>>4},${d[i+2]>>4}`);return seen.size;}),{timeout:30000}).toBeGreaterThan(5);
   await shot('post-open');
  });
  await step('post approved',async()=>{
   await page.getByRole('button',{name:'Prepare final image'}).click();
   await expect(page.getByRole('img',{name:'Saved final image for approval'})).toBeVisible({timeout:LONG});
   await page.getByRole('button',{name:'Send for review'}).click();
   const reviewed=page.getByRole('checkbox',{name:'I reviewed this saved image and its text.'});
   await expect(reviewed).toBeVisible({timeout:60000});
   await reviewed.check();
   await page.getByRole('button',{name:'Approve final image'}).click();
   await expect(page.getByRole('region',{name:'Post details'}).getByText('Approved',{exact:true})).toBeVisible({timeout:60000});
   await page.reload();
   await expect(page.getByRole('region',{name:'Post details'}).getByText('Approved',{exact:true})).toBeVisible();
   await shot('post-approved');
  });
  await step('approvals page',async()=>{
   await page.goto(`${base}/b/${businessId}/review`);
   await page.waitForLoadState('networkidle');
   await shot('approvals');
  });
 }catch{/* recorded in results */}
 finally{await browser.close();}
 return {results,shots:SHOTS,email};
}
