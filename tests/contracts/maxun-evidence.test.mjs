import test from 'node:test';import assert from 'node:assert/strict';
import {maxunEvidence} from '../../dist/maxun-evidence.js';
const page={metadata:{url:'https://example.org/',title:'Example'},text:'Example makes tools.',markdown:'# Example',html:'<h1>Example</h1>',links:['/about','javascript:alert(1)','http://127.0.0.1/'],screenshotFullpage:'crawl-1-screenshot-fullpage'};
test('capture keeps every textual format and provenance, filters unsafe links (audited-source fixture, not live Cloud evidence)',()=>{
 const {pages}=maxunEvidence({crawlData:[page]},'https://example.org');
 assert.equal(pages[0].text,page.text);assert.equal(pages[0].html,page.html);assert.equal(pages[0].markdown,page.markdown);
 assert.deepEqual(pages[0].links,['https://example.org/about']);assert.equal(pages[0].sha256.length,64);
 assert.deepEqual(pages[0].screenshotKeys,['crawl-1-screenshot-fullpage']);
});
test('foreign-domain data, unsupported shapes and empty captures are never accepted as a brand profile',()=>{
 assert.throws(()=>maxunEvidence({crawlData:[{...page,metadata:{url:'https://foreign.org/'}}]},'https://example.org'),/MAXUN_SCOPE_MISMATCH/);
 assert.throws(()=>maxunEvidence({crawlData:{}},'https://example.org'),/MAXUN_RESPONSE_INVALID/);
 assert.throws(()=>maxunEvidence({crawlData:[{...page,text:'',markdown:''}]},'https://example.org'),/WEBSITE_NO_CONTENT/);
});
test('partial page failures preserve usable evidence and report missing coverage',()=>{
 const r=maxunEvidence({crawlData:[page,{metadata:{url:'https://example.org/about',statusCode:403}}]},'https://example.org');
 assert.equal(r.pages.length,1);assert.deepEqual(r.skipped,[{url:'https://example.org/about',code:'MAXUN_PAGE_FAILED'}]);
});
