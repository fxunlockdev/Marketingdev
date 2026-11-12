import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreativeSpec,creativeDimensions,creativeSourceSize,acceptedCreativeDimensions,matchesCreativeDimensions,legacyCreativeDimensions} from '../../dist/campaign-formats.js';
import {creativeMediaUsageSQL,creativeMediaUsed,creativeStorageFits} from '../../dist/creative-storage.js';
import {GENERATION_LIMITS} from '../../dist/creative-budget.js';
const spec=(placement='feed',aspect='square',slide_count=null)=>({placement,aspect,slide_count});
test('campaign format matrix preserves feed video and requires genuine vertical story/reel targets',()=>{
 for(const channel of ['instagram','facebook','linkedin'])for(const format of ['static','ad','video','carousel'])for(const aspect of ['square','portrait','landscape'])assert.deepEqual(normalizeCreativeSpec(spec('feed',aspect,format==='carousel'?3:null),format,channel),spec('feed',aspect,format==='carousel'?3:null));
 for(const channel of ['instagram','facebook'])for(const [format,placement] of [['static','story'],['video','story'],['video','reel']])assert.deepEqual(creativeDimensions(normalizeCreativeSpec(spec(placement,'vertical'),format,channel)),{width:1080,height:1920});
 assert.equal(creativeSourceSize(spec('story','vertical')),'1024x1536');
});
test('campaign specification rejects incompatible channels, dimensions, slide counts and unknown properties',()=>{
 const invalid=[[null,'static','instagram'],[spec('story','vertical'),'static','linkedin'],[spec('reel','vertical'),'static','instagram'],[spec('story','portrait'),'video','instagram'],[spec('feed','vertical'),'static','instagram'],[spec('feed','square',1),'carousel','instagram'],[spec('feed','square',2.5),'carousel','instagram'],[spec('feed','square',11),'carousel','instagram'],[spec('feed','square',2),'static','instagram'],[{...spec(),extra:true},'static','instagram'],[spec(),'static','youtube']];
 for(const args of invalid)assert.throws(()=>normalizeCreativeSpec(...args),{code:'CAMPAIGN_FORMAT_INVALID'});
});


test('post artwork persists exact font choices and rejects unrenderable or unknown configuration',()=>{
 const typography={headline:{family:'Playfair Display',weight:600},body:{family:'Montserrat',weight:500}};
 for(const artwork of [{text:'none'},{text:'headline',typography}]){
  const input={...spec(),artwork};assert.deepEqual(normalizeCreativeSpec(input,'static','instagram'),input);
  assert.throws(()=>normalizeCreativeSpec(input,'video','instagram'),{code:'CAMPAIGN_FORMAT_INVALID'});
 }
 for(const artwork of [null,{}, {text:'other'},{text:'headline',extra:true},{text:'headline',typography:{...typography,extra:true}},{text:'headline',typography:{...typography,headline:{family:'Lora',weight:900}}},{text:'headline',typography:{...typography,headline:{family:'Lora',weight:600,url:'https://example.com/font'}}}])assert.throws(()=>normalizeCreativeSpec({...spec(),artwork},'static','instagram'),{code:'CAMPAIGN_FORMAT_INVALID'});
});

test('portrait feed posts are composed at 4:5 from the 2:3 provider size; 2:3 portraits made earlier stay valid',()=>{
 const portrait=spec('feed','portrait');
 assert.deepEqual(creativeDimensions(portrait),{width:1024,height:1280});
 assert.equal(creativeSourceSize(portrait),'1024x1536');
 assert.deepEqual(acceptedCreativeDimensions(portrait),[{width:1024,height:1280},{width:1024,height:1536}]);
 assert.ok(matchesCreativeDimensions(portrait,{width:1024,height:1280}));assert.ok(matchesCreativeDimensions(portrait,{width:1024,height:1536}));
 assert.ok(!matchesCreativeDimensions(portrait,{width:1024,height:1024}));assert.ok(!matchesCreativeDimensions(portrait,null));
 assert.ok(legacyCreativeDimensions(portrait,{width:1024,height:1536}));assert.ok(!legacyCreativeDimensions(portrait,{width:1024,height:1280}));
 for(const aspect of ['square','landscape']){const s=spec('feed',aspect);assert.deepEqual(acceptedCreativeDimensions(s),[creativeDimensions(s)]);assert.ok(!legacyCreativeDimensions(s,{width:1024,height:1536}));}
 assert.ok(!matchesCreativeDimensions(spec('feed','square'),{width:1024,height:1536}),'only portrait has a legacy size');
 // The video renderer supports 2:3 portrait only, so a LinkedIn portrait video keeps that size.
 assert.deepEqual(creativeDimensions(normalizeCreativeSpec(portrait,'video','linkedin')),{width:1024,height:1536});
 for(const format of ['static','ad'])assert.deepEqual(creativeDimensions(normalizeCreativeSpec(portrait,format,'linkedin')),{width:1024,height:1280});
 assert.deepEqual(creativeDimensions(normalizeCreativeSpec(spec('feed','portrait',3),'carousel','instagram')),{width:1024,height:1280});
 assert.deepEqual(normalizeCreativeSpec(portrait,'video','linkedin'),portrait,'the stored spec is unchanged');
});
test('creative storage uses one rolling, archive-aware window for every path',async()=>{
 // The rolling, archive-aware count lives in one database function (migration 142) so it stays fast under RLS.
 assert.equal(creativeMediaUsageSQL,'SELECT app.creative_media_used($1,$2,$3) AS n');
 const fn=(await import('node:fs')).readFileSync(new URL('../../database/migrations/142_creative_media_usage.sql',import.meta.url),'utf8');
 assert.match(fn,/archived_at IS NOT NULL/);assert.match(fn,/make_interval\(days=>window_days\)/);
 const seen=[];const used=await creativeMediaUsed({query:async(sql,params)=>{seen.push([sql,params]);return {rows:[{n:'123'}]};}},'org','brand');
 assert.equal(used,123);assert.deepEqual(seen,[[creativeMediaUsageSQL,['org','brand',GENERATION_LIMITS.windowDays]]]);
 assert.ok(creativeStorageFits(GENERATION_LIMITS.storageBytes-GENERATION_LIMITS.reserveBytes));
 assert.ok(!creativeStorageFits(GENERATION_LIMITS.storageBytes-GENERATION_LIMITS.reserveBytes+1));
 assert.ok(!creativeStorageFits(0,Math.floor(GENERATION_LIMITS.storageBytes/GENERATION_LIMITS.reserveBytes)+1));
 assert.ok(!creativeStorageFits(Number.NaN));
});
