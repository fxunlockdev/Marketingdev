import test from 'node:test';
import assert from 'node:assert/strict';
import {SafeWebRobots} from '../../dist/agent-reach-research.js';

const reply=(status,body='',location)=>({status,headers:location?{location}:{},bytes:Buffer.from(body)});
const web=(routes)=>{const seen=[];return {seen,fetch:async(url)=>{seen.push(url.href);const r=routes[url.href];if(!r)throw new Error('unexpected '+url.href);return r;}};};

test('robots.txt behind a same-site redirect (www to apex, http to https) is followed and honoured',async()=>{
 const w=web({'https://www.example-homes.com/robots.txt':reply(301,'','https://example-homes.com/robots.txt'),
  'https://example-homes.com/robots.txt':reply(200,'User-agent: *\nDisallow: /admin/\nAllow: /\n')});
 const robots=new SafeWebRobots(w);
 assert.equal(await robots.allowed('https://www.example-homes.com/'),true);
 assert.equal(await robots.allowed('https://www.example-homes.com/admin/x'),false);
 assert.deepEqual(w.seen,['https://www.example-homes.com/robots.txt','https://example-homes.com/robots.txt'],'fetched once per origin');
});

test('a redirect to another site, a loop or too many hops refuses, as before',async()=>{
 assert.equal(await new SafeWebRobots(web({'https://a-homes.com/robots.txt':reply(302,'','https://tracker.example.net/robots.txt')})).allowed('https://a-homes.com/'),false);
 assert.equal(await new SafeWebRobots(web({'https://b-homes.com/robots.txt':reply(301,'','https://b-homes.com/robots.txt')})).allowed('https://b-homes.com/'),false);
 const hops={};for(let i=0;i<5;i++)hops[`https://c${i}.c-homes.com/robots.txt`]=reply(301,'',`https://c${i+1}.c-homes.com/robots.txt`);
 assert.equal(await new SafeWebRobots(web(hops)).allowed('https://c0.c-homes.com/'),false);
 assert.equal(await new SafeWebRobots(web({'https://d-homes.com/robots.txt':reply(404)})).allowed('https://d-homes.com/'),true,'no robots.txt still allows');
});
