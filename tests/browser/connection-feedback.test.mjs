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
