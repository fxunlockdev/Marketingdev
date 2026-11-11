import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {StockAssets} from '../../dist/stock-assets.js';
const scope={organizationId:'org',brandId:'brand',jobId:'job'};
const jpg=await sharp({create:{width:64,height:64,channels:3,background:'#123456'}}).jpeg().toBuffer();
function fixture({attribution=false,networkFailure=false}={}){
 let row=null,downloads=0,copies=0;const objects=new Map();
 const db={query:async(sql,p)=>{
  if(sql.startsWith('SELECT * FROM app.stock_grants'))return {rows:[{max_daily_downloads:2}]};
  if(sql.startsWith('SELECT * FROM app.stock_acquisitions'))return {rows:row?[row]:[]};
  if(sql.startsWith('SELECT count'))return {rows:[{n:0}]};
  if(sql.startsWith('INSERT')){row={resource_id:p[3],status:'acquiring'};return {rows:[]};}
  if(sql.includes('requires_attribution=$2')){row.requires_attribution=p[1];return {rows:[]};}
  if(sql.includes("status='ready'")){Object.assign(row,{status:'ready',object_key:p[1],sha256:p[2],bytes:p[3]});return {rows:[]};}
  if(sql.includes('status=$2')){row.status=p[1];return {rows:[]};}
  throw Error('Unhandled SQL');
 }};
 const jobs={transaction:async(s,fn)=>{assert.equal(s,scope);return fn(db,{});},permitted:async()=>true,scanner:{scan:async()=>{}},store:{persist:async(k,b)=>objects.set(k,b),read:async k=>objects.get(k)}};
 const vendor={configured:true,download:async()=>{downloads++;if(networkFailure)throw Error('timeout');return {url:'https://example.com/photo.jpg',requiresAttribution:attribution,attributionURL:attribution?'https://www.vecteezy.com/photo/42':null};}};
 const web={fetch:async()=>{copies++;return {status:200,bytes:jpg};}};
 return {service:new StockAssets(jobs,vendor,web),state:()=>({row,downloads,copies})};
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
