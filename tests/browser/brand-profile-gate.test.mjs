import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const origin=process.env.DESVIO_UI_BASE;
const brand='11111111-1111-4111-8111-111111111111';
const GATE='Approve your brand profile to start creating';
const F=(n,field,value)=>({id:`00000000-0000-4000-8000-00000000000${n}`,field,value,status:'unreviewed',revision:1});

/** One business with an unapproved profile like a fresh guided onboarding: two names, offer, audience, voice. */
async function mockAPI(page,{role='owner'}={}){
 const state={approved:false,patches:[],approvals:[],sends:0,revision:3,
  findings:[F(1,'brand_name','Runwal Enterprises'),F(2,'brand_name','Test 1'),F(3,'offering','Residential, retail and commercial property'),F(4,'audience','Working families'),F(5,'voice','Warm and clear')]};
 await page.route('**/api/**',async r=>{
  const req=r.request(),u=new URL(req.url()).pathname,method=req.method();let data={};
  const business={id:brand,organization_id:brand,name:'Test 1',role,has_approved_brand:state.approved};
  if(u.endsWith('/get-session'))data={user:{id:'one',name:'Owner',emailVerified:true}};
  else if(u==='/api/v1/businesses')data={businesses:[business]};
  else if(/\/brain\/findings\/[^/]+$/.test(u)&&method==='PATCH'){
   const id=u.split('/').pop(),body=req.postDataJSON();state.patches.push({id,...body});
   const f=state.findings.find(x=>x.id===id);f.status=body.decision;f.revision++;
   for(const alt of body.alternatives??[]){const a=state.findings.find(x=>x.id===alt.id);a.status='wrong';a.revision++;}
   state.revision++;data=f;
  }
  else if(u.endsWith('/brain/approve')){state.approvals.push(req.postDataJSON());state.approved=true;data={id:'v1'};}
  else if(u.endsWith('/brain'))data={revision:state.revision,findings:state.findings,visuals:[],sources:[],active:null,jobs:[]};
  else if(u.endsWith('/outbox')){data={request:null};}
  else if(u.endsWith('/create-chat/messages')){state.sends++;data={conversation_id:'22222222-2222-4222-8222-222222222222',id:'33333333-3333-4333-8333-333333333333'};}
  else if(u.endsWith('/history'))data={conversations:[]};
  else if(u.endsWith('/generation-notifications'))data={notifications:[]};
  else if(u.endsWith('/knowledge'))data={nodes:[],edges:[],next_cursor:null};
  else if(u.endsWith('/prompt-suggestions'))data={context:'',preference_key:'k',dismissed:true};
  await r.fulfill({json:data});
 });
 return state;
}

test('MOCK API: an owner approves the brand profile inline from chat, choosing between two names',{skip:!origin,timeout:90000},async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:920}}),state=await mockAPI(page);
  await page.goto(`${origin}/b/${brand}/create`);
  const gate=page.getByRole('complementary',{name:GATE});
  await expect(gate).toBeVisible();
  await expect(gate.getByText('Residential, retail and commercial property')).toBeVisible();
  await expect(gate.getByRole('radio',{name:'Runwal Enterprises'})).toBeChecked();
  await gate.getByRole('radio',{name:'Test 1'}).check();
  await expect(gate.getByRole('link',{name:'Edit details in Brand Kit'})).toHaveAttribute('href',`/b/${brand}/brand-kit#profile`);
  await gate.getByRole('button',{name:'Approve and start creating'}).click();
  await expect(page.getByRole('complementary',{name:GATE})).toHaveCount(0);
  // The chosen name is confirmed and its alternative replaced in one decision; every other fact is confirmed; then one approval.
  const name=state.patches.find(p=>p.id.endsWith('2'));
  assert.deepEqual(name,{id:'00000000-0000-4000-8000-000000000002',revision:1,decision:'correct',alternatives:[{id:'00000000-0000-4000-8000-000000000001',revision:1}]});
  assert.deepEqual(state.patches.map(p=>p.decision),['correct','correct','correct','correct']);
  assert.deepEqual(state.approvals,[{revision:7}]);
  await expect(page.getByRole('textbox',{name:'Message Desvio'})).toBeEnabled();
 }finally{await browser.close();}
});

test('MOCK API: the knowledge page offers the same approval, and an editor is told to ask an owner',{skip:!origin,timeout:90000},async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1440,height:920}});await mockAPI(page);
  await page.goto(`${origin}/b/${brand}/knowledge`);
  await expect(page.getByRole('complementary',{name:GATE}).getByRole('button',{name:'Approve and start creating'})).toBeVisible();
  const editor=await browser.newPage({viewport:{width:390,height:900}});const state=await mockAPI(editor,{role:'editor'});
  await editor.goto(`${origin}/b/${brand}/create`);
  const gate=editor.getByRole('complementary',{name:GATE});
  await expect(gate.getByText(/Ask an owner or admin of this business to approve it/)).toBeVisible();
  await expect(gate.getByRole('button')).toHaveCount(0);
  assert.equal(state.patches.length,0);
  assert.equal(await editor.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }finally{await browser.close();}
});
