import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AGENT_REACH_PIN,AGENT_REACH_VERSION,REACH_LIMITS,REFUSED_CHANNELS,ALLOWED_ACTIONS,AgentReachRefused,reachTask,parseEnvelope,sizeEvidence,dedupePages,initialTasks,followUps,withinBounds,reachInput,ownLinks,loginWalled,taskKey} from '../../dist/agent-reach-contract.js';
import {sandboxArgs,mockServerOrigin} from '../../dist/agent-reach-sandbox.js';
import {mockAgentReachEnvelope} from '../../dist/agent-reach-mock.js';
import {agentReachFromEnv} from '../../dist/config.js';
import {selectEvidence} from '../../dist/intake-jobs.js';

const DIGEST='sha256:'+'a'.repeat(64);
// The exact envelope the pinned CLI printed for `agent-reach web read https://example.com` (run once, locally).
const exampleRead={schema_version:1,ok:true,channel:'web',action:'read',backend:'jina',items:[{title:'Example Domain',url:'https://example.com',author:null,published_at:'Thu, 12 Nov 2026 21:56:22 GMT',text:'This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.',raw:null}],meta:{elapsed_ms:563,attempts:[{backend:'jina',result:'ok'}]},error:null};
const read=target=>reachTask({id:1,channel:'web',action:'read',params:{target},purpose:'own_page',subject:'Example'});

test('the pin is an exact commit of the GitHub repository, matching the image pin file',()=>{
 const pin=JSON.parse(readFileSync(new URL('../../infra/agent-reach-image.json',import.meta.url),'utf8'));
 assert.match(AGENT_REACH_PIN.commit,/^[a-f0-9]{40}$/);assert.equal(pin.commit,AGENT_REACH_PIN.commit);assert.match(pin.tree,/^[a-f0-9]{40}$/);
 assert.equal(pin.repository,'https://github.com/Panniantong/Agent-Reach.git');
});

test('only login-free channels run: every login, cookie or keyed channel and transcription is refused',()=>{
 assert.deepEqual(ALLOWED_ACTIONS.map(a=>a.join(' ')),['web search','web read','youtube search','youtube read','youtube subtitle']);
 for(const channel of REFUSED_CHANNELS)for(const action of ['search','read','user','profile'])
  assert.throws(()=>reachTask({id:1,channel,action,params:{query:'x',target:'https://example.com/'},purpose:'business_search'}),e=>e instanceof AgentReachRefused&&e.code==='AGENT_REACH_CHANNEL_REFUSED');
 assert.throws(()=>reachTask({id:1,channel:'youtube',action:'transcribe',params:{target:'https://youtu.be/jNQXAC9IVRw'},purpose:'video_subtitle'}),/AGENT_REACH_CHANNEL_REFUSED/);
 // Login-walled sites are not read even through the web channel.
 for(const url of ['https://www.instagram.com/brand','https://x.com/brand','https://www.facebook.com/brand','https://www.reddit.com/r/x','https://www.linkedin.com/company/x','https://www.xiaohongshu.com/x'])
  assert.throws(()=>read(url),/AGENT_REACH_TARGET_REFUSED/);
 for(const url of ['http://127.0.0.1/','http://localhost/','https://intranet.internal/','file:///etc/passwd'])assert.throws(()=>read(url),/AGENT_REACH_TARGET_REFUSED/);
 assert.equal(read('https://example.com/?utm_source=x#top').params.target,'https://example.com/');
 const search=reachTask({id:2,channel:'web',action:'search',params:{query:'  Runwal Mumbai  ',limit:5},purpose:'business_search'});
 assert.deepEqual(search.params,{query:'Runwal Mumbai',limit:5});
 assert.throws(()=>reachTask({id:2,channel:'web',action:'search',params:{query:'x',limit:50},purpose:'business_search'}),/AGENT_REACH_TASK_INVALID/);
 assert.equal(loginWalled('https://m.facebook.com/x'),true);assert.equal(loginWalled('https://example.com/'),false);
});

test('the parser accepts the pinned CLI envelope, cleans text and rejects envelopes for another task',()=>{
 const parsed=parseEnvelope(exampleRead,{channel:'web',action:'read'});
 assert.equal(parsed.ok,true);assert.equal(parsed.backend,'jina');assert.equal(parsed.items[0].title,'Example Domain');assert.deepEqual(parsed.attempts,[{backend:'jina',result:'ok'}]);
 assert.throws(()=>parseEnvelope(exampleRead,{channel:'youtube',action:'read'}),/AGENT_REACH_OUTPUT_INVALID/);
 assert.throws(()=>parseEnvelope({...exampleRead,schema_version:2},{channel:'web',action:'read'}),/AGENT_REACH_OUTPUT_INVALID/);
 assert.throws(()=>parseEnvelope(null,{channel:'web',action:'read'}),/AGENT_REACH_OUTPUT_INVALID/);
 const noisy=parseEnvelope({...exampleRead,items:Array.from({length:30},()=>({title:'T\u0000itle',url:'https://example.com',text:'x'.repeat(50000),raw:{cookie:'secret'}}))},{channel:'web',action:'read'});
 assert.equal(noisy.items.length,REACH_LIMITS.itemsPerEnvelope);assert.equal(noisy.items[0].title,'Title');assert.equal(noisy.items[0].text.length,REACH_LIMITS.itemChars);assert.equal('raw' in noisy.items[0],false);
 const failed=parseEnvelope({schema_version:1,ok:false,channel:'web',action:'read',backend:null,items:[],meta:{attempts:[{backend:'jina',result:'RATE_LIMITED'},{backend:'exa',result:'RATE_LIMITED'}]},error:{code:'RATE_LIMITED',message:'HTTP 429',hint:'wait'}},{channel:'web',action:'read'});
 assert.deepEqual([failed.ok,failed.error.code,failed.items.length,failed.attempts.length],[false,'RATE_LIMITED',0,2]);
});

test('the sizer cites URL, title, retrieval time and channel, bounds every page and splits own from market',()=>{
 const own=sizeEvidence(read('https://example.com/'),parseEnvelope({...exampleRead,items:[{...exampleRead.items[0],text:('Paragraph. '.repeat(120)+'\n\n').repeat(10)}]},{channel:'web',action:'read'}),'https://www.example.com/','2026-11-13T10:00:00.000Z');
 assert.equal(own.length,1);const page=own[0];
 assert.equal(page.parserVersion,AGENT_REACH_VERSION);assert.equal(page.origin,'own');assert.equal(page.coverage,'agent_reach_page_text');assert.equal(page.provider,'jina');assert.equal(page.truncated,true);
 assert.match(page.chunks[0].text,/Agent Reach web read via jina, retrieved 2026-11-13T10:00:00.000Z/);assert.match(page.chunks[0].text,/Title: Example Domain\nURL: https:\/\/example.com\//);
 assert.ok(page.chunks.every(c=>c.text.length<=REACH_LIMITS.chunkChars));
 assert.ok(page.chunks.reduce((n,c)=>n+c.text.length,0)<=REACH_LIMITS.pageChars+400);
 const search=reachTask({id:3,channel:'web',action:'search',params:{query:'Rival Mumbai',limit:3},purpose:'competitor_search',subject:'Rival'});
 const hits=sizeEvidence(search,parseEnvelope({...mockAgentReachEnvelope(search),items:[{title:'Rival',url:'https://rival.test/a?utm_medium=x',text:'Rival sells flats. '.repeat(100)},{title:'Insta',url:'https://instagram.com/rival',text:'login wall '.repeat(10)},{title:'Own',url:'https://example.com/about',text:'Our own about page, found by search, describing the homes we build.'}]},search),'https://example.com/','2026-11-13T10:00:00.000Z');
 assert.deepEqual(hits.map(h=>[h.url,h.origin]),[['https://rival.test/a','market'],['https://example.com/about','own']]);
 assert.ok(hits[0].chunks[0].text.length<=REACH_LIMITS.snippetChars+400);assert.match(hits[0].chunks[0].text,/never wording to copy/);
 const video=reachTask({id:4,channel:'youtube',action:'search',params:{query:'Runwal',limit:2},purpose:'video_search',subject:'Runwal'});
 const videos=sizeEvidence(video,parseEnvelope(mockAgentReachEnvelope(video),video),'https://example.com/','2026-11-13T10:00:00.000Z');
 assert.equal(videos.length,2);assert.ok(videos.every(v=>/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(v.url)&&v.origin==='market'&&v.provider==='yt-dlp'));
 assert.deepEqual(sizeEvidence(read('https://example.com/'),parseEnvelope({...exampleRead,ok:false,items:[],error:{code:'TIMEOUT',message:''}},{channel:'web',action:'read'}),'https://example.com/','x'),[]);
});

test('deduplication keeps one page per URL (a read beats a search snippet), drops repeated content and caps total size',()=>{
 const at='2026-11-13T10:00:00.000Z',search=reachTask({id:3,channel:'web',action:'search',params:{query:'Example',limit:3},purpose:'business_search'});
 const snippet=sizeEvidence(search,parseEnvelope({...mockAgentReachEnvelope(search),items:[{title:'Example',url:'https://example.com/',text:'A snippet about the example site.'}]},search),'https://example.com/',at);
 const full=sizeEvidence(read('https://example.com/'),parseEnvelope(exampleRead,{channel:'web',action:'read'}),'https://example.com/',at);
 const kept=dedupePages([...snippet,...full,...full]);
 assert.equal(kept.length,1);assert.equal(kept[0].action,'read');
 const many=Array.from({length:20},(_,i)=>sizeEvidence(read(`https://example.com/p${i}`),parseEnvelope({...exampleRead,items:[{...exampleRead.items[0],text:`Page ${i} `+'words '.repeat(800)}]},{channel:'web',action:'read'}),'https://example.com/',at)[0]);
 const capped=dedupePages(many);
 assert.ok(capped.length<20);assert.ok(capped.reduce((n,p)=>n+p.chunks.reduce((m,c)=>m+c.text.length,0),0)<=REACH_LIMITS.totalChars);
 assert.equal(dedupePages(full,new Set(['https://example.com/'])).length,0);
});

test('a full plan from the answers stays within 3 searches, 8 reads, 2 video searches and 1 subtitle',()=>{
 const input=reachInput('https://www.runwal.test/',{market:'Mumbai',details:{business_name:'Runwal Enterprises',competitors:['Lodha','godrejproperties.test','Oberoi Realty']}});
 const done=[];let queue=initialTasks(input);
 while(queue.length){
  const draft=queue.shift();if(!withinBounds(done,draft))continue;
  const task=reachTask({...draft,id:done.length+1});if(done.some(t=>taskKey(t)===taskKey(task)))continue;done.push(task);
  queue.push(...followUps(task,parseEnvelope(mockAgentReachEnvelope(task),task),input));
 }
 const count=(c,a)=>done.filter(t=>t.channel===c&&t.action===a).length;
 assert.ok(count('web','search')<=3&&count('web','read')<=8&&count('youtube','search')<=2&&count('youtube','subtitle')<=1);
 assert.equal(count('web','search'),3);assert.ok(count('web','read')>=5);
 assert.ok(done.some(t=>t.purpose==='own_page'&&t.params.target==='https://www.runwal.test/about'),'own key pages follow the home page');
 assert.ok(done.some(t=>t.purpose==='competitor_page'&&t.params.target==='https://godrejproperties.test/'),'a named competitor site is read');
 assert.ok(!done.some(t=>loginWalled(t.params.target??'')),'login-walled links are never followed');
 assert.deepEqual(initialTasks(input).filter(t=>t.action==='search').map(t=>t.params.query),['Runwal Enterprises Mumbai','Lodha Mumbai','godrejproperties.test Mumbai','Runwal Enterprises Mumbai','Lodha']);
 assert.deepEqual(ownLinks('[a](https://www.runwal.test/about) [b](https://other.test/about) [c](https://www.runwal.test/blog?id=1)','https://www.runwal.test/'),['https://www.runwal.test/about']);
});

test('analysis evidence: own pages first, the market share split between GPT notes and Agent Reach pages',()=>{
 const row=(id,len,market=false,agent_reach=false)=>({id,source_id:id,text:'x'.repeat(len),page:1,website_url:null,market,agent_reach});
 const chosen=selectEvidence([row('reach-own',3000,false,true),row('own',3000),row('ai',10000,true),row('reach',10000,true,true)]);
 assert.deepEqual(chosen.map(c=>c.id),['own','reach-own','ai','reach']);
 assert.deepEqual(chosen.map(c=>c.text.length),[3000,3000,6000,6000]);
 assert.ok(chosen.every(c=>!('agent_reach' in c)));assert.equal(chosen[2].origin,'market');
 // Without Agent Reach pages GPT notes keep the whole market share, exactly as before.
 assert.deepEqual(selectEvidence([row('ai',13000,true),row('own',1000)]).map(c=>c.text.length),[1000,12000]);
 assert.deepEqual(selectEvidence([row('ai',2000,true),row('reach',20000,true,true)]).map(c=>c.text.length),[2000,10000]);
});

test('the sandbox has a network but no credentials, no Docker socket, a read-only root and bounded resources',()=>{
 const args=sandboxArgs(DIGEST,'desvio-agent-reach-test');
 for(const flag of ['--read-only','--cap-drop=ALL','no-new-privileges','--pids-limit','--memory','--memory-swap','--cpus','65534:65534','HOME=/tmp/home'])assert.ok(args.includes(flag),flag);
 assert.equal(args[args.indexOf('--network')+1],'bridge');assert.equal(args.at(-1),DIGEST);
 assert.ok(!args.some(a=>/docker\.sock|OPENAI|KEY|TOKEN|SECRET|--privileged|-v$|--mount/i.test(a)));
 assert.equal(args.filter(a=>a==='--env').length,1);
 assert.throws(()=>sandboxArgs('desvio-agent-reach:latest','x'),/exact local image digest/);
});

test('switch and settings: on by default in development and test, off unless set in staging; mock on loopback only',()=>{
 assert.equal(agentReachFromEnv({},'development').enabled,true);assert.equal(agentReachFromEnv({},'test').enabled,true);
 assert.equal(agentReachFromEnv({},'staging').enabled,false);assert.equal(agentReachFromEnv({AGENT_REACH_ENABLED:'true',AGENT_REACH_IMAGE:DIGEST},'staging').enabled,true);
 assert.equal(agentReachFromEnv({AGENT_REACH_ENABLED:'false'},'development').enabled,false);
 assert.throws(()=>agentReachFromEnv({AGENT_REACH_ENABLED:'yes'},'staging'),/true or false/);
 assert.throws(()=>agentReachFromEnv({AGENT_REACH_IMAGE:'agent-reach:latest'},'staging'),/exact local image digest/);
 assert.equal(mockServerOrigin('http://127.0.0.1:54010/','development'),'http://127.0.0.1:54010');
 assert.throws(()=>mockServerOrigin('http://127.0.0.1:54010/','staging'),/only when APP_MODE/);
 assert.throws(()=>mockServerOrigin('https://mock.example.com/','test'),/loopback/);
 assert.equal(mockServerOrigin(undefined,'staging'),undefined);
});

test('the mock answers only allowed actions, deterministically and without the network',()=>{
 const task={channel:'web',action:'search',params:{query:'Early cafe Lisbon',limit:2}};
 assert.deepEqual(mockAgentReachEnvelope(task),mockAgentReachEnvelope(task));
 assert.equal(mockAgentReachEnvelope({channel:'twitter',action:'search',params:{query:'x'}}).ok,false);
});

test('the sandbox runner refuses login channels and unsafe targets without starting Agent Reach',t=>{
 const python=spawnSync('python3',['--version']);if(python.status!==0)return t.skip('python3 not installed');
 const home=mkdtempSync(join(tmpdir(),'agent-reach-runner-'));
 try{
  const input=[{id:1,channel:'twitter',action:'search',params:{query:'x'}},{id:2,channel:'instagram',action:'read',params:{target:'https://instagram.com/x'}},{id:3,channel:'youtube',action:'transcribe',params:{target:'https://youtu.be/jNQXAC9IVRw'}},{id:4,channel:'web',action:'read',params:{target:'file:///etc/passwd'}},{id:5,channel:'web',action:'search',params:{query:'x',limit:99}},{type:'end'}];
  const run=spawnSync('python3',['-I',fileURLToPath(new URL('../../apps/agent-reach/runtime.py',import.meta.url))],{input:input.map(l=>JSON.stringify(l)).join('\n')+'\n',env:{HOME:join(home,'h'),PATH:process.env.PATH},encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,run.stderr);
  const lines=run.stdout.trim().split('\n').map(l=>JSON.parse(l)),codes=Object.fromEntries(lines.filter(l=>l.type==='result').map(l=>[l.id,l.envelope.error.code]));
  assert.deepEqual(lines[0],{type:'ready',version:'agent-reach-runner-v1'});
  assert.deepEqual(codes,{1:'CHANNEL_NOT_ALLOWED',2:'CHANNEL_NOT_ALLOWED',3:'CHANNEL_NOT_ALLOWED',4:'BAD_INPUT',5:'BAD_INPUT'});
 }finally{rmSync(home,{recursive:true,force:true});}
});
