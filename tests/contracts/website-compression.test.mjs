import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,brotliCompressSync,deflateSync} from 'node:zlib';
import {decodeWebsiteBody} from '../../dist/safe-web.js';
const page=Buffer.from('<html><title>Brand</title>'+ 'brand '.repeat(1000)+'</html>');
for(const [encoding,encode] of [['gzip',gzipSync],['br',brotliCompressSync],['deflate',deflateSync]]) {
 test(`${encoding}: reads website text and bounds decompressed output`,async()=>{
  const compressed=encode(page);
  assert.deepEqual(await decodeWebsiteBody(compressed,encoding,page.length),page);
  await assert.rejects(decodeWebsiteBody(compressed,encoding,page.length-1),/WEBSITE_PAGE_TOO_LARGE/);
  await assert.rejects(decodeWebsiteBody(Buffer.from('invalid'),encoding,100),/WEBSITE_COMPRESSION_INVALID/);
  await assert.rejects(decodeWebsiteBody(compressed,encoding,compressed.length-1),/WEBSITE_PAGE_TOO_LARGE/);
 });
}
test('identity is bounded; unsupported encoding cannot select inherited properties',async()=>{
 assert.deepEqual(await decodeWebsiteBody(page,undefined,page.length),page);
 assert.deepEqual(await decodeWebsiteBody(page,'identity',page.length),page);
 await assert.rejects(decodeWebsiteBody(page,'identity',page.length-1),/WEBSITE_PAGE_TOO_LARGE/);
 for(const encoding of ['zstd','__proto__','gzip, br'])await assert.rejects(decodeWebsiteBody(page,encoding,page.length),/WEBSITE_ENCODING_UNSUPPORTED/);
});
