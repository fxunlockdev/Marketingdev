import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE,brand='11111111-1111-4111-8111-111111111111';
test('connection actions explain permissions, show pending state and recover after failure',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();let canManage=true,release;let calls=0;
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data={};
 if(path.endsWith('/get-session'))data={user:{id:'owner',name:'Maya',emailVerified:true}};
 else if(path==='/api/v1/businesses')data={businesses:[{id:brand,organization_id:brand,name:'Studio',role:'owner',has_approved_brand:true}]};
 else if(path.endsWith('/postforme/connections'))data={provider:'postforme',configured:true,can_manage:canManage,accounts:[],platforms:['instagram','facebook','linkedin']};
 else if(path.endsWith('/authorize')){calls++;await new Promise(resolve=>release=resolve);await route.fulfill({status:503,json:{message:'Connection unavailable. Try again.'}});return;}
 await route.fulfill({json:data});});
 try{await page.goto(`${origin}/b/${brand}/connections`);await page.getByRole('button',{name:'Connect Instagram',exact:true}).click();
 const pending=page.getByRole('button',{name:'Preparing Instagram…',exact:true});await expect(pending).toBeVisible();await expect(pending).toBeDisabled();
 const facebook=page.getByRole('button',{name:'Connect Facebook',exact:true});await expect(facebook).toBeDisabled();
 const colors=await facebook.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,opacity:getComputedStyle(el).opacity}));assert.equal(colors.opacity,'1');assert.notEqual(colors.color,colors.background);
 release();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Connect Instagram',exact:true})).toBeEnabled();assert.equal(calls,1);
 canManage=false;await page.reload();await expect(page.getByText('A business owner or administrator can connect accounts. You can view their status here.')).toBeVisible();await expect(page.getByRole('button',{name:'Connect Instagram',exact:true})).toBeDisabled();
 for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
 }finally{release?.();await browser.close();}
});

test('one-profile connection handoff can be canceled without publishing or disconnecting accounts',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage();let canceled=false;const pending={id:'22222222-2222-4222-8222-222222222222',platform:'instagram',expires_at:'2099-01-01T00:00:00Z'};
 const view=()=>({provider:'postforme',configured:true,can_manage:true,social_profile_limit:1,accounts:[],platforms:['instagram','facebook'],attempt:canceled?null:pending});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data={};
 if(path.endsWith('/get-session'))data={user:{id:'owner',name:'Maya',emailVerified:true}};
 else if(path==='/api/v1/businesses')data={businesses:[{id:brand,organization_id:brand,name:'Studio',role:'owner',has_approved_brand:true}]};
 else if(path.endsWith('/postforme/connections'))data=view();
 else if(path.endsWith('/connections/cancel')){assert.deepEqual(route.request().postDataJSON(),{attempt_id:pending.id});canceled=true;data=view();}
 await route.fulfill({json:data});});
 try{await page.goto(`${origin}/b/${brand}/connections`);await expect(page.getByText(/Your plan includes one social profile/)).toBeVisible();await page.getByRole('button',{name:'Cancel connection attempt',exact:true}).click();await expect(page.getByRole('heading',{name:'Finish connecting your account',exact:true})).toHaveCount(0);await expect(page.getByText('Connection attempt canceled. You can choose another platform.',{exact:true})).toBeVisible();assert.equal(canceled,true);await page.reload();await expect(page.getByRole('heading',{name:'Finish connecting your account',exact:true})).toHaveCount(0);}finally{await browser.close();}
});
