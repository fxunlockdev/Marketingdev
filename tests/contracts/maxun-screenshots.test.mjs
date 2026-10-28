import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import{maxunScreenshotURL,maxunScreenshot}from'../../dist/maxun-screenshots.js';
const run='00000000-0000-4000-8000-000000000001',key='crawl-1-screenshot-fullpage',url=`https://media.example.org/${run}/${key}`;
test('screenshot association rejects foreign run IDs, duplicate media, unsafe and unmatched URLs',()=>{
 assert.equal(maxunScreenshotURL([url],key,run).href,url);
 for(const media of [[url,url],[url.replace(run,'foreign')],['http://127.0.0.1/'+run+'/'+key],['https://media.example.org/unmatched']])assert.throws(()=>maxunScreenshotURL(media,key,run),/REFERENCE_INVALID/);
});
test('screenshot bytes are decoded and normalized before private persistence (MOCK download)',async()=>{
 const bytes=await sharp({create:{width:600,height:1200,channels:3,background:'#abc'}}).png().toBuffer();
 const r=await maxunScreenshot([url],key,run,{fetch:async(u,limit,accept)=>{assert.equal(u.href,url);assert.equal(limit,20*1024*1024);assert.match(accept,/image\/png/);return{status:200,bytes};}});
 assert.equal(r.width,600);assert.equal(r.height,1200);assert.equal(r.kind,'fullpage');assert.equal((await sharp(r.bytes).metadata()).format,'jpeg');
 await assert.rejects(maxunScreenshot([url],key,run,{fetch:async()=>({status:200,bytes:Buffer.from('<html>error</html>')})}),/SCREENSHOT_INVALID/);
});
test('Maxun Cloud URL references match typed media records and preserve full-page identity',async()=>{
 const cloud=`https://maxuncloud-run-screenshots.s3.us-east-1.amazonaws.com/${run}/Crawl - 0 - Full Page`;
 const media=[{data:cloud,mimeType:'image/png'}];
 assert.equal(maxunScreenshotURL(media,cloud,run).href,new URL(cloud).href);
 const bytes=await sharp({create:{width:600,height:1200,channels:3,background:'#abc'}}).png().toBuffer();
 const result=await maxunScreenshot(media,cloud,run,{fetch:async u=>{assert.equal(u.href,new URL(cloud).href);return {status:200,bytes};}});
 assert.equal(result.kind,'fullpage');assert.equal(result.height,1200);
 for(const invalid of [[{data:cloud,mimeType:'text/html'}],[...media,...media],[{data:cloud.replace(run,'foreign'),mimeType:'image/png'}],[{data:cloud.replace('maxuncloud-run-screenshots.s3.us-east-1.amazonaws.com','other.example.org'),mimeType:'image/png'}]])assert.throws(()=>maxunScreenshotURL(invalid,cloud,run),/REFERENCE_INVALID/);
 assert.throws(()=>maxunScreenshotURL(media,cloud.replace(run,'foreign'),run),/REFERENCE_INVALID/);
});
test('Cloud screenshot references cannot introduce credential-bearing, private or non-image URLs',()=>{
 for(const ref of [`http://example.org/${run}/Crawl - 0 - Visible`,`https://localhost/${run}/Crawl - 0 - Visible`,`https://user:password@example.org/${run}/Crawl - 0 - Visible`,`https://example.org/${run}/unexpected`])assert.throws(()=>maxunScreenshotURL([{data:ref,mimeType:'image/png'}],ref,run),/REFERENCE_INVALID/);
});
