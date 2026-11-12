import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {StockAssets,stockSourceDistance,tooCloseToStock,STOCK_TOO_CLOSE_DISTANCE} from '../../dist/stock-assets.js';
import {StockError} from '../../dist/vecteezy-client.js';
import {CreativeError} from '../../dist/creative-contracts.js';
const scope={organizationId:'org',brandId:'brand',jobId:'job'};
const jpg=await sharp({create:{width:64,height:64,channels:3,background:'#123456'}}).jpeg().toBuffer();
function fixture({attribution=false,networkFailure=false,grant=true,first=null,fetch=null,search=async()=>[{id:42,title:'Courtyard',previewURL:null,aiGenerated:false}]}={}){
 let row=null,selection=null,downloads=0,copies=0,searches=0;const objects=new Map();
 const db={query:async(sql,p)=>{
  if(sql.startsWith('SELECT a.job_id'))return {rows:first?[first]:[]};
  if(sql.startsWith('SELECT * FROM app.stock_grants'))return {rows:grant?[{max_daily_downloads:2}]:[]};
  if(sql.startsWith('SELECT * FROM app.stock_acquisitions'))return {rows:row?[row]:[]};
  if(sql.startsWith('SELECT count'))return {rows:[{n:0}]};
  if(sql.startsWith('INSERT INTO app.stock_acquisitions')){row={resource_id:p[3],status:'acquiring'};return {rows:[]};}
  if(sql.includes('requires_attribution=$2')){row.requires_attribution=p[1];return {rows:[]};}
  if(sql.includes("status='ready'")){Object.assign(row,{status:'ready',object_key:p[1],sha256:p[2],bytes:p[3]});return {rows:[]};}
  if(sql.includes('status=$2')){row.status=p[1];return {rows:[]};}
  if(sql.startsWith('SELECT * FROM app.stock_selections'))return {rows:selection?[selection]:[]};
  if(sql.startsWith('INSERT INTO app.stock_selections(job_id,organization_id,brand_id,candidates,outcome')){selection={candidates:[],...selection,outcome:p[3],skip_reason:p[4],selected_resource_id:p[5]??selection?.selected_resource_id??null,use_as:p[6]??selection?.use_as??null,source_job_id:p[7]};return {rows:[]};}
  if(sql.startsWith('INSERT INTO app.stock_selections')){selection??={query:p[3],queries:JSON.parse(p[4]),candidates:JSON.parse(p[5]),outcome:null};return {rows:[]};}
  throw Error('Unhandled SQL: '+sql);
 }};
 const jobs={transaction:async(s,fn)=>{assert.equal(s,scope);return fn(db,{});},permitted:async()=>true,scanner:{scan:async()=>{}},store:{persist:async(k,b)=>objects.set(k,b),read:async k=>objects.get(k)}};
 const vendor={configured:true,search:async(...a)=>{searches++;return search(...a);},download:async()=>{downloads++;if(networkFailure)throw new StockError('STOCK_DOWNLOAD_UNKNOWN');return {url:'https://example.com/photo.jpg',requiresAttribution:attribution,attributionURL:attribution?'https://www.vecteezy.com/photo/42':null};}};
 const web={fetch:fetch??(async()=>{copies++;return {status:200,bytes:jpg};})};
 return {service:new StockAssets(jobs,vendor,web),objects,state:()=>({row,selection,downloads,copies,searches})};
}
test('saved stock is reused without another purchase or network copy',async()=>{
 const f=fixture();const first=await f.service.acquire(scope,42),second=await f.service.acquire(scope,42);
 assert.deepEqual(first,second);assert.equal(f.state().downloads,1);assert.equal(f.state().copies,1);assert.equal(f.state().row.status,'ready');
 await assert.rejects(f.service.acquire(scope,43),{code:'STOCK_SELECTION_CHANGED'});
});
test('failed acquisition remains held and cannot silently purchase again',async()=>{
 const f=fixture({networkFailure:true});await assert.rejects(f.service.acquire(scope,42));
 await assert.rejects(f.service.acquire(scope,42),{code:'STOCK_DOWNLOAD_UNKNOWN'});assert.equal(f.state().downloads,1);
});
test('required visible attribution prevents private-only asset use',async()=>{
 const f=fixture({attribution:true});await assert.rejects(f.service.acquire(scope,42),{code:'STOCK_ATTRIBUTION_REQUIRED'});
 assert.equal(f.state().copies,0);assert.equal(f.state().row.status,'rejected');
 await assert.rejects(f.service.acquire(scope,42),{code:'STOCK_ASSET_REJECTED'});assert.equal(f.state().downloads,1);
});
const input={brand:{facts:[]}},context={imagePrompt:'Quiet courtyard',orientation:'square'};
const planner=(choice={resource_id:42})=>{const calls=[];const plan=async request=>{calls.push(request.step);return {content:JSON.stringify(request.step===4?{queries:['modern courtyard']}:choice),tool_calls:[]};};return Object.assign(plan,{calls});};
test('a chosen stock photo is returned with its use and the decision is recorded',async()=>{
 const f=fixture(),plan=planner(),found=await f.service.reference(scope,input,context,plan);
 assert.ok(Buffer.isBuffer(found.photo));assert.equal(found.use,'inspiration');
 assert.equal(f.state().selection.outcome,'selected');assert.equal(f.state().selection.selected_resource_id,42);
 assert.deepEqual(await f.service.reference(scope,input,context,plan),found);
 assert.deepEqual(plan.calls,[4,5]);assert.equal(f.state().searches,1);assert.equal(f.state().downloads,1);
});
for(const [name,options,choice,reason] of [
 ['no search results',{search:async()=>[]},undefined,'STOCK_NO_RESULTS'],
 ['no relevant result',{},{resource_id:0},'STOCK_NO_RELEVANT_RESULT'],
 ['a missing grant',{grant:false},undefined,'STOCK_GRANT_REQUIRED'],
 ['a rate limit',{search:async()=>{const e=new StockError('STOCK_RATE_LIMITED');throw e;}},undefined,'STOCK_RATE_LIMITED'],
 ['required attribution',{attribution:true},undefined,'STOCK_ATTRIBUTION_REQUIRED'],
 ['an uncertain download',{networkFailure:true},undefined,'STOCK_DOWNLOAD_UNKNOWN'],
])test(`${name} skips stock, records why and never fails the creative`,async()=>{
 const f=fixture(options),plan=planner(choice);
 assert.equal(await f.service.reference(scope,input,context,plan),null);
 assert.equal(f.state().selection.outcome,'skipped');assert.equal(f.state().selection.skip_reason,reason);
 const before={...f.state()},steps=plan.calls.length;
 // A replay keeps the recorded decision: no new search, model call or purchase.
 assert.equal(await f.service.reference(scope,input,context,plan),null);
 assert.equal(plan.calls.length,steps);assert.equal(f.state().searches,before.searches);assert.equal(f.state().downloads,before.downloads);
});
test('an uncertain download stays recorded for reconciliation and is never bought again',async()=>{
 const f=fixture({networkFailure:true});assert.equal(await f.service.reference(scope,input,context,planner()),null);
 assert.equal(f.state().row.status,'unknown');assert.equal(f.state().selection.selected_resource_id,42);
 await assert.rejects(f.service.acquire(scope,42),{code:'STOCK_DOWNLOAD_UNKNOWN'});assert.equal(f.state().downloads,1);
});
test('a planning call that cannot be made skips stock, but revoked access still stops the job',async()=>{
 const f=fixture();
 assert.equal(await f.service.reference(scope,input,context,async()=>{throw new CreativeError('CREATIVE_REQUEST_BUDGET_EXHAUSTED');}),null);
 assert.equal(f.state().selection.skip_reason,'CREATIVE_REQUEST_BUDGET_EXHAUSTED');
 const g=fixture();
 await assert.rejects(g.service.reference(scope,input,context,async()=>{throw new CreativeError('CREATIVE_ACCESS_REVOKED');}),{code:'CREATIVE_ACCESS_REVOKED'});
 await assert.rejects(fixture().service.reference(scope,input,context,async()=>{throw new Error('database down');}),/database down/);
});
test('edits, supplied brand references and type-led briefs go ahead without any stock call',async()=>{
 for(const [extra,reason] of [[{edit:true},'STOCK_SKIPPED_EDIT'],[{brandReferences:1},'STOCK_SKIPPED_BRAND_REFERENCES'],[{layoutArchetype:'type_led'},'STOCK_SKIPPED_TYPE_LED']]){
  const f=fixture(),plan=planner();
  assert.equal(await f.service.reference(scope,input,{...context,...extra},plan),null);
  assert.equal(f.state().selection.skip_reason,reason);assert.deepEqual(plan.calls,[]);assert.equal(f.state().searches,0);assert.equal(f.state().downloads,0);
 }
});
test('later carousel slides reuse the first slide photo and never search or buy',async()=>{
 const key='stock/org/brand/first/abc',{digest}=await import('../../dist/object-store.js');
 const f=fixture({first:{job_id:'first',resource_id:'42',object_key:key,sha256:digest(jpg),bytes:jpg.length,use_as:'base'}}),plan=planner();
 f.objects.set(key,jpg);
 const found=await f.service.reference(scope,input,{...context,carouselPosition:2},plan);
 assert.deepEqual(found,{photo:jpg,use:'base'});assert.deepEqual(plan.calls,[]);assert.equal(f.state().searches,0);assert.equal(f.state().downloads,0);
 assert.equal(f.state().selection.outcome,'reused');assert.equal(f.state().selection.source_job_id,'first');
 assert.deepEqual(await f.service.reference(scope,input,{...context,carouselPosition:2},plan),found);
 const none=fixture();assert.equal(await none.service.reference(scope,input,{...context,carouselPosition:1},planner()),null);
 assert.equal(none.state().selection.skip_reason,'STOCK_SKIPPED_CAROUSEL_SLIDE');assert.equal(none.state().searches,0);
});
test('up to three queries are searched, merged and capped, and a failing query keeps earlier results',async()=>{
 const photo=id=>({id,title:`t${id}`,previewURL:`https://example.com/p${id}`,aiGenerated:false}),terms=[];
 const g=fixture({search:async term=>{terms.push(term);if(term==='ccc')throw new StockError('STOCK_RATE_LIMITED');return Array.from({length:12},(_,i)=>photo((term==='aaa'?0:6)+i+1));}});
 const good=async request=>({content:JSON.stringify(request.step===4?{queries:['aaa','bbb','ccc']}:{resource_id:18}),tool_calls:[]});
 assert.equal((await g.service.reference(scope,input,context,good)).use,'inspiration');
 assert.deepEqual(terms,['aaa','bbb','ccc']);
 const saved=g.state().selection;assert.equal(saved.candidates.length,18);assert.deepEqual(saved.queries,['aaa','bbb','ccc']);
 assert.ok(saved.candidates.every(c=>c.previewURL===null));assert.equal(g.state().row.resource_id,18);
});
test('previews are fetched over https only, bounded, shown to the ranker and never stored',async()=>{
 const fetched=[];let copies=0;
 const fetch=async(url,maxBytes,accept)=>{if(accept==='image/jpeg'){copies++;return {status:200,bytes:jpg};}fetched.push({href:url.href,maxBytes});if(url.href.endsWith('broken'))throw Error('timeout');return {status:200,bytes:jpg};};
 const f=fixture({fetch,search:async()=>[{id:41,title:'A',previewURL:'https://example.com/a',aiGenerated:false},{id:42,title:'B',previewURL:'https://example.com/broken',aiGenerated:false},{id:43,title:'C',previewURL:'http://example.com/plain',aiGenerated:false},{id:44,title:'D',previewURL:null,aiGenerated:false}]});
 let ranking;
 const plan=async request=>{if(request.step===5)ranking=request;return {content:JSON.stringify(request.step===4?{queries:['courtyard']}:{resource_id:41,use:'base'}),tool_calls:[]};};
 const found=await f.service.reference(scope,input,{...context,vision:true},plan);
 assert.equal(found.use,'base');assert.equal(f.state().selection.use_as,'base');
 assert.deepEqual(fetched.map(x=>x.href),['https://example.com/a','https://example.com/broken']);assert.ok(fetched.every(x=>x.maxBytes<=2*1024*1024));
 assert.equal(ranking.images.length,1);assert.equal((await sharp(Buffer.from(ranking.images[0].data,'base64')).metadata()).format,'jpeg');
 assert.doesNotMatch(JSON.stringify(ranking.messages),/example\.com/);assert.doesNotMatch(JSON.stringify(f.state().selection),/example\.com/);
});
test('ranking falls back to titles when no preview can be fetched or the model cannot see images',async()=>{
 for(const vision of [true,false]){
  let ranking,previewFetches=0;
  const fetch=async(url,maxBytes,accept)=>{if(accept==='image/jpeg')return {status:200,bytes:jpg};previewFetches++;return {status:404,bytes:Buffer.alloc(0)};};
  const f=fixture({fetch,search:async()=>[{id:42,title:'Courtyard',previewURL:'https://example.com/a',aiGenerated:false}]});
  const plan=async request=>{if(request.step===5)ranking=request;return {content:JSON.stringify(request.step===4?{queries:['courtyard']}:{resource_id:42}),tool_calls:[]};};
  assert.equal((await f.service.reference(scope,input,{...context,vision},plan)).use,'inspiration');
  assert.equal(ranking.images,undefined);assert.match(ranking.messages[0].content,/Do not claim to have visually inspected/);assert.equal(previewFetches,vision?1:0);
 }
});
test('too-close guard flags a near copy of the stock photo and passes a redesigned creative',async()=>{
 const noise=seed=>{const data=Buffer.alloc(64*64*3);let v=seed;for(let i=0;i<data.length;i++){v=(v*1103515245+12345)&0x7fffffff;data[i]=v>>16&255;}return sharp(data,{raw:{width:64,height:64,channels:3}}).blur(4).resize(512,512).png().toBuffer();};
 const stock=await noise(7),other=await noise(99);
 const copy=await sharp(stock).resize(1024,1024).modulate({brightness:1.05}).jpeg({quality:70}).toBuffer();
 assert.equal(await stockSourceDistance(stock,stock),0);
 const near=await tooCloseToStock(stock,copy);assert.ok(near.tooClose,`distance ${near.distance}`);assert.ok(near.distance<=STOCK_TOO_CLOSE_DISTANCE);
 const far=await tooCloseToStock(stock,other);assert.ok(!far.tooClose,`distance ${far.distance}`);assert.ok(far.distance>16);
 assert.equal((await tooCloseToStock(stock,other,64)).tooClose,true);
 await assert.rejects(stockSourceDistance(stock,Buffer.from('not an image')));
});
