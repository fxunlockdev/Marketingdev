// Operator-only public website probe. No database, AI provider, or tenant mutation.
import {execFileSync} from 'node:child_process';
import {WebsiteRenderer} from '/opt/desvio/dist/website-renderer.js';
import {WebsiteRenderBroker} from '/opt/desvio/dist/website-render-broker.js';
let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>4096)throw Error('PROBE_INPUT_LIMIT');}
const input=JSON.parse(raw);
if(input.url!=='https://runwalrealty.com/'||!/^sha256:[a-f0-9]{64}$/.test(input.image??''))throw Error('PROBE_SCOPE_INVALID');
let inspected=false,broker;const denied={};
const renderer=new WebsiteRenderer(input.image,(url,permitted)=>{
 broker=new WebsiteRenderBroker(url,undefined,permitted);const request=broker.request.bind(broker);
 broker.request=async message=>{
  if(!inspected){
   const ids=execFileSync('docker',['ps','-q','--filter','label=desvio.purpose=website-render-sandbox'],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);
   if(ids.length!==1)throw Error('PROBE_CONCURRENT_RENDERER');
   const c=JSON.parse(execFileSync('docker',['inspect',ids[0]],{encoding:'utf8'}))[0];
   if(c.Image!==input.image||c.HostConfig.NetworkMode!=='none'||!c.HostConfig.ReadonlyRootfs||c.Config.User!=='65534:65534'||!c.HostConfig.CapDrop.includes('ALL')||c.HostConfig.Memory!==1073741824||c.HostConfig.Binds?.length)throw Error('PROBE_BOUNDARY_INVALID');
   inspected=true;
  }
  try{return await request(message);}catch(e){const code=/^[A-Z_]+$/.test(e.code??'')?e.code:'RESOURCE_DENIED';denied[code]=(denied[code]??0)+1;throw e;}
 };return broker;
});
// Explicit operator gate: this tests capture only, not tenant authorization.
const gate={transaction:async(_scope,fn)=>fn({}, {kind:'website.extract'}),permitted:async()=>true};
try{
 const output=await renderer.capture(gate,{},input.url);
 const assets=[];
 for(const [url,entry] of output.captures){for(const shot of entry.capture.snapshots){if(assets.filter(a=>a.kind===shot.label).length>=3)continue;assets.push({kind:shot.label,page_url:url,sha256:shot.sha256,width:shot.viewport.width,height:shot.height,source_url:shot.observations.source_url,base64:shot.screenshot});}}
 const chars=output.pages.reduce((n,p)=>n+p.chunks.reduce((m,c)=>m+c.text.length,0),0);
 console.log(JSON.stringify({passed:inspected&&chars>100&&output.coverage.photosAvailable>0,operator_probe:true,tenant_authorization_tested:false,url:input.url,image:input.image,isolated_browser_verified:inspected,paid_calls:0,database_mutations:0,coverage:output.coverage,capture_diagnostics:output.captureDiagnostics??[],text_characters:chars,text_sample:output.pages.flatMap(p=>p.chunks).map(c=>c.text).join('\n').slice(0,1600),broker_requests:broker.requests,broker_bytes:broker.bytes,denied_resources:denied,visual_errors:output.visualErrors,assets}));
}catch(e){console.log(JSON.stringify({passed:false,url:input.url,image:input.image,isolated_browser_verified:inspected,paid_calls:0,database_mutations:0,error:/^[A-Z_]+$/.test(e.code??'')?e.code:'WEBSITE_CAPTURE_FAILED',broker_requests:broker?.requests,capture_diagnostics:e.captureDiagnostics??[],denied_resources:denied}));process.exitCode=1;}
