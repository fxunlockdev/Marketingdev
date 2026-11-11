import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE;
test('MOCK API: workspace survives a transient read failure, but does not retry initialization writes',{skip:!origin,timeout:60000},async()=>{
 const browser=await chromium.launch();
 const id='11111111-1111-4111-8111-111111111111';
 try{
  for(const failure of ['read','initialize']){
   const context=await browser.newContext(),page=await context.newPage();let reads=0,writes=0;
   await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data={};
    if(path.endsWith('/get-session'))data={user:{id,name:'Maya',email:'maya@example.com',emailVerified:true}};
    else if(path.endsWith('/initialize')){writes++;if(failure==='initialize')return route.abort('failed');}
    else if(path==='/api/v1/businesses'){
     reads++;if(failure==='read'&&reads===1)return route.abort('failed');
     data={businesses:[{id,organization_id:id,name:'Courtyard Studio',website:null,role:'owner',has_approved_brand:false}]};
    }
    else if(path.endsWith('/assets'))data={assets:[]};
    else if(path.endsWith('/canvas/references'))data={references:[]};
    else if(path.endsWith('/generation-notifications'))data={notifications:[]};
    else if(path.endsWith('/guided-brief'))data={onboarding:{social_profile_limit:1,channels:['instagram']},revision:0,step:0,brief:{offering:'',audience:'',market:'',goal:'awareness',visual_direction:'',must_follow:''},research_job_id:null};
    await route.fulfill({json:data});
   });
   await page.goto(`${origin}/b/${id}/guided-onboarding`);
   if(failure==='read'){
    await expect(page.getByRole('heading',{name:'Tell us about your business'})).toBeVisible();
    await expect(page.getByRole('heading',{name:'We couldn’t open Desvio.'})).toHaveCount(0);
    assert.equal(reads,2);assert.equal(writes,1);
   }else{
    await expect(page.getByRole('heading',{name:'We couldn’t open Desvio.'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
    assert.equal(writes,1);assert.equal(reads,0);
   }
   await context.close();
  }
 }finally{await browser.close();}
});
