import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';
const origin=process.env.DESVIO_UI_BASE,brand='11111111-1111-4111-8111-111111111111';
const image=await sharp({create:{width:640,height:427,channels:3,background:'#8172ad'}}).webp().toBuffer();
test('home cards use small previews, preserve overlays and distinguish uncreated carousels',{skip:!origin,timeout:30000},async()=>{
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}});let previewReads=0,originalReads=0;
 const post={id:'one',channel:'instagram',format:'static',hook:'Home',brief:'Home',state:'draft_ready',planned_at:'2026-11-20T11:00:00Z',timezone:'UTC',starts_on:'2026-11-20',plan_title:'Campaign',generation_status:null,design:{background_media_id:brand,width:1536,height:1024,layers:[{id:'headline',text:'Saved headline',x:100,y:100,width:1000,fontFamily:'Arial',fontSize:64,fill:'#ffffff'}]}};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let data={};
  if(path.endsWith('/get-session'))data={user:{id:'owner',name:'Maya',emailVerified:true}};
  else if(path==='/api/v1/businesses')data={businesses:[{id:brand,organization_id:brand,name:'Studio',role:'owner',has_approved_brand:true}]};
  else if(path.endsWith('/overview'))data={counts:{},upcoming_posts:[post,{...post,id:'two',format:'carousel',design:null,state:'content_needed'}],activity:[],recommendations:[],generation_activity:[],campaigns:[],performance:{posts:[]}};
  else if(path.endsWith('/preview')){previewReads++;await route.fulfill({contentType:'image/webp',body:image});return;}
  else if(path.includes('/creative-media/'))originalReads++;
  await route.fulfill({json:data});
 });
 try{
  await page.goto(`${origin}/b/${brand}/overview`);
  await expect(page.locator('.post-thumbnail svg image')).toHaveAttribute('href',/^blob:/);
  await expect(page.locator('.post-thumbnail').first()).toContainText('Saved headline');
  assert.equal(previewReads,1);assert.equal(originalReads,0);
  await expect(page.locator('.post-thumbnail').nth(1)).toContainText('Carousel');await expect(page.locator('.upcoming-copy').nth(1)).toContainText('Ready to create');
  await page.setViewportSize({width:390,height:844});await expect(page.locator('.post-thumbnail svg image')).toHaveAttribute('href',/^blob:/);
 }finally{await browser.close();}
});
