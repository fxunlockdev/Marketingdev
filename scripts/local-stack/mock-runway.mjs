// Local mock of the Runway endpoints Desvio's adapter calls, for `--mock --with-video` runs.
// It listens on 127.0.0.1 only, never forwards anything, and answers like the audited router
// contract (ADR 0052): routers, POST /v1/generate/video, task status and cancel. Each task fetches
// its first-frame reference from local storage and renders a real small H.264 MP4 from it with
// ffmpeg (slow push-in at the requested aspect and duration, labelled "Local mock video").
// Every request is appended to work/local-stack/runway-requests.jsonl so what Runway would have
// received can be read back exactly.
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {appendFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import sharp from 'sharp';

const run=promisify(execFile);
const API_VERSION='2024-11-06';
const SIZES={'9:16':[1080,1920],'16:9':[1920,1080],'1:1':[1080,1080],'3:4':[1080,1440],'4:3':[1440,1080]};
const SHORT_SIZES={'9:16':[720,1280],'16:9':[1280,720],'1:1':[720,720],'3:4':[720,960],'4:3':[960,720]};
const FPS=24;

function readBody(req){
 return new Promise((resolve,reject)=>{const chunks=[];let size=0;
  req.on('data',c=>{size+=c.length;if(size>1024*1024){reject(new Error('body too large'));req.destroy();}else chunks.push(c);});
  req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);});
}
const json=(res,status,value)=>{const body=JSON.stringify(value);res.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body)});res.end(body);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** A real MP4 made from the reference frame: cover-cropped to the requested frame, slow push-in, labelled. */
export async function mockClip(frame,{aspectRatio,duration,resolution},ffmpeg='ffmpeg'){
 const [width,height]=(resolution==='720p'?SHORT_SIZES:SIZES)[aspectRatio];
 const dir=mkdtempSync(join(tmpdir(),'desvio-mock-runway-'));
 try{
  const input=join(dir,'frame.png'),output=join(dir,'clip.mp4');
  // The label is drawn into the frame here so any ffmpeg build works (no drawtext needed).
  const band=Math.round(height/14),label=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${band}"><rect width="100%" height="100%" fill="black" fill-opacity="0.45"/><text x="50%" y="62%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(band*0.42)}" fill="white">Local mock video</text></svg>`);
  writeFileSync(input,await sharp(frame,{limitInputPixels:40_000_000}).resize(width,height,{fit:'cover'}).composite([{input:label,top:height-band,left:0}]).png().toBuffer());
  const frames=duration*FPS;
  const filter=`zoompan=z='1+0.08*on/${frames}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${FPS}`;
  await run(ffmpeg,['-v','error','-nostdin','-y','-i',input,'-vf',filter,'-t',String(duration),'-r',String(FPS),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',output],{timeout:120000});
  return readFileSync(output);
 }finally{rmSync(dir,{recursive:true,force:true});}
}

/** Starts the mock on 127.0.0.1:port. `log` records each request as one JSON line. */
export async function startMockRunway(port,say,{logFile,ffmpeg='ffmpeg'}={}){
 const routers=new Map(),tasks=new Map(),outputs=new Map(),origin=`http://127.0.0.1:${port}`;
 const record=entry=>{if(logFile)appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),...entry})+'\n',{mode:0o600});};
 async function generate(body,res){
  const input=body.input??{},uri=input.referenceImages?.[0]?.uri;
  let reference=null;
  try{
   const r=await fetch(uri,{redirect:'error'});if(r.status!==200)throw new Error(`reference HTTP ${r.status}`);
   const bytes=Buffer.from(await r.arrayBuffer()),meta=await sharp(bytes).metadata();
   reference={bytes,sha256:sha(bytes),width:meta.width,height:meta.height,format:meta.format,content_type:r.headers.get('content-type'),bytes_length:bytes.length};
  }catch(error){record({kind:'generate',body,reference_error:String(error.message)});return json(res,400,{error:'Reference image could not be read'});}
  if(!SIZES[input.aspectRatio]||!Number.isInteger(input.duration)||input.duration<2||input.duration>15||input.audio!==false||typeof input.promptText!=='string')return json(res,400,{error:'Invalid input'});
  const id=randomUUID(),router=routers.get(body.configId);
  if(!router)return json(res,400,{code:'no_eligible_model'});
  const {bytes:_frame,...frame}=reference;
  record({kind:'generate',id,body,reference:frame});
  tasks.set(id,{status:'PENDING',created:Date.now()});
  mockClip(reference.bytes,{aspectRatio:input.aspectRatio,duration:input.duration,resolution:input.resolution},ffmpeg)
   .then(clip=>{outputs.set(id,clip);tasks.set(id,{status:'SUCCEEDED',created:tasks.get(id).created});say(`mock runway task ${id} ready (${clip.length} bytes)`);})
   .catch(error=>{tasks.set(id,{status:'FAILED',created:tasks.get(id).created});say(`mock runway task ${id} failed: ${error.message}`);});
  const cap=router.settings.maxCreditsPerGeneration.video;
  json(res,200,{id,dryRun:false,routing:{model:'mock-gen',provider:'local-mock',configId:body.configId,resolvedSettings:{optimizeFor:'quality',priceCeiling:cap},estimatedCost:{credits:Math.min(cap,input.duration*5)}}});
 }
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/outputs/')){
    const clip=outputs.get(url.pathname.slice(9).replace(/\.mp4$/,''));
    if(!clip)return json(res,404,{error:'Not found'});
    res.writeHead(200,{'content-type':'video/mp4','content-length':clip.length});return res.end(clip);
   }
   if(req.headers.authorization!=='Bearer local-mock-runway-key'||req.headers['x-runway-version']!==API_VERSION)return json(res,401,{error:'Unauthorized'});
   const body=['POST'].includes(req.method)?JSON.parse((await readBody(req)).toString('utf8')||'{}'):null;
   if(url.pathname==='/v1/routers'&&req.method==='GET'){record({kind:'routers.list'});return json(res,200,{data:[...routers.values()],hasMore:false,nextCursor:null});}
   if(url.pathname==='/v1/routers'&&req.method==='POST'){record({kind:'routers.create',body});const router={...body,id:randomUUID()};routers.set(body.slug,router);return json(res,200,router);}
   if(url.pathname==='/v1/generate/video'&&req.method==='POST')return generate(body,res);
   const task=url.pathname.match(/^\/v1\/tasks\/([a-f0-9-]{36})$/);
   if(task&&req.method==='DELETE'){record({kind:'cancel',id:task[1]});tasks.set(task[1],{...(tasks.get(task[1])??{}),status:'CANCELLED'});res.writeHead(204);return res.end();}
   if(task&&req.method==='GET'){
    const t=tasks.get(task[1]);if(!t)return json(res,404,{error:'Not found'});
    const progress=t.status==='SUCCEEDED'?1:Math.min(0.9,(Date.now()-t.created)/20000);
    return json(res,200,{id:task[1],status:t.status==='PENDING'&&progress>0.05?'RUNNING':t.status,progress,...(t.status==='SUCCEEDED'?{output:[`${origin}/outputs/${task[1]}.mp4`]}:{}),...(t.status==='FAILED'?{failure:'Mock render failed'}:{})});
   }
   json(res,404,{error:'Not found'});
  }catch(error){say(`mock runway error: ${error.message}`);if(!res.headersSent)json(res,500,{error:'Mock error'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 say(`mock runway listening on ${origin}`);
 return {origin,close:()=>new Promise(resolve=>server.close(()=>resolve()))};
}

const MOCK_VIDEO_GRANT={models:['runway/router'],budget_micros:50_000_000,max_create_micros:1_000_000,max_edit_micros:1_000_000};
/** Mock-mode video grants for every business that lacks a current one, through the audited operator path
 * (preview, then apply). The router cap of 1,000,000 micros is 100 mock credits per clip. */
export async function grantMockVideo(pool,configure,databaseName){
 const missing=(await pool.query(`SELECT b.organization_id,b.id FROM app.brands b WHERE NOT EXISTS(SELECT 1 FROM app.video_grants g WHERE g.brand_id=b.id AND g.enabled AND g.expires_at>now()+interval '7 days')`)).rows;
 const applied=[];
 for(const b of missing){
  const manifest={version:1,change_id:randomUUID(),organization_id:b.organization_id,business_id:b.id,operator_reference:'local-stack mock mode (mock Runway)',
   grants:[{kind:'video',enabled:true,expires_at:new Date(Date.now()+30*86400000).toISOString(),...MOCK_VIDEO_GRANT}]};
  const options={expectedDatabase:databaseName,mode:'development'};
  const preview=await configure(pool,manifest,options);
  if(preview.status==='preview')await configure(pool,manifest,{...options,approval:preview.preview_sha256});
  applied.push(`video:${b.id}`);
 }
 return applied;
}

/** A valid video brief for the mock planner (format desvio_video_brief): contiguous beats over the requested
 * duration (read from the schema's time bound), one short overlay, the first allowed fact. Labelled as mock. */
export function mockVideoBrief(schema){
 const duration=schema.properties.beats.items.properties.end_ms.maximum,facts=schema.properties.fact_ids.items.enum;
 const short=duration<=3000,third=Math.floor(duration/3/100)*100;
 const beats=[[0,third,'Hands lift a tray of fresh sourdough from the oven','Slow push in'],[third,third*2,'Loaves cool on wooden racks in warm window light','Gentle pan right'],[third*2,duration,'A customer takes a warm loaf at the counter','Static medium shot']]
  .map(([start_ms,end_ms,action,camera])=>({start_ms,end_ms,action:short?String(action).slice(0,90):action,camera:short?String(camera).slice(0,36):camera}));
 return {title:'Morning bake (local mock)',caption:'Fresh from the oven every morning. Local mock caption.',
  video_prompt:short?'Warm bakery at opening time, steam over fresh loaves, soft morning light.':'Warm neighbourhood bakery at opening time. Steam rises from fresh sourdough; soft morning light through the window; natural, unhurried camera movement; true-to-life colour.',
  fact_ids:[facts[0]],warnings:[],beats,overlays:[{text:'Baked this morning',start_ms:0,end_ms:Math.min(duration,2000),position:'top',foreground:'#ffffff',background:'#1f4e5f'}]};
}
