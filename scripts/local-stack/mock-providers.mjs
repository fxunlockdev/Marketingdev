// Local mock of the OpenAI Responses and Images endpoints for `--mock` runs.
// Deterministic: the same request shape always yields the same kind of answer, valid
// against the strict JSON schema the request carries and against Desvio's own checks.
// It never forwards anything anywhere; it listens on 127.0.0.1 only.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {generate} from './mock-schema.mjs';

const MAX_BODY=60*1024*1024;
const PALETTE=['#1F4E5F','#F2A541','#F7F1E8'];

function readBody(req){
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0;
  req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('body too large'));req.destroy();}else chunks.push(c);});
  req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject);
 });
}
const id=(prefix,seed)=>`${prefix}_mock_${createHash('sha256').update(seed).digest('hex').slice(0,24)}`;
const usage=(text='')=>({input_tokens:1200,input_tokens_details:{cached_tokens:0},output_tokens:Math.max(50,Math.ceil(text.length/4)),output_tokens_details:{reasoning_tokens:0},total_tokens:1200+Math.max(50,Math.ceil(text.length/4))});

function responseEnvelope(body,output,text){
 return {id:id('resp',JSON.stringify(body).slice(0,20000)+Date.now()),object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,
  output,output_text:text,parallel_tool_calls:false,tool_choice:body.tool_choice??'auto',tools:body.tools??[],usage:usage(text),error:null,incomplete_details:null};
}
const message=(text,annotations=[])=>({type:'message',id:id('msg',text),status:'completed',role:'assistant',content:[{type:'output_text',text,annotations}]});

/** Plain text of every input message, in order. */
function inputTexts(input){
 if(typeof input==='string')return [input];
 return (input??[]).flatMap(m=>typeof m.content==='string'?[m.content]:(m.content??[]).filter(c=>c.type==='input_text').map(c=>c.text));
}
/** The task JSON the skills sandbox sends as the user message. */
function plannerTask(body){
 const marker='UNTRUSTED BUSINESS DATA AND REQUEST:\n';
 for(const text of inputTexts(body.input)){const at=text.indexOf(marker);if(at>=0){try{return JSON.parse(text.slice(at+marker.length));}catch{/* not the task */}}}
 return null;
}
function businessName(task){
 const brand=task?.brand??{};
 return brand.name??brand.business_name??brand.identity?.name??'Your business';
}

// ---- Website and market research (hosted web search) ---------------------------------
function websiteResearch(body){
 const domain=body.tools?.[0]?.filters?.allowed_domains?.[0]??'example.com';
 const home=`https://${domain}/`,about=`https://${domain}/about`;
 const name=domain.split('.')[0].replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
 const paragraphs=[
  [`${name} is an independent business that presents its products and services on ${domain}.`,home],
  [`The website describes friendly service, quality products and a focus on regular local customers.`,home],
  [`${name} highlights what makes it different: consistency, care and an easy way to get in touch.`,about],
 ];
 let text='';const annotations=[];
 for(const [paragraph,url] of paragraphs){
  if(text)text+='\n\n';
  const start=text.length;text+=paragraph;
  annotations.push({type:'url_citation',start_index:start,end_index:text.length,url,title:name});
 }
 const search={type:'web_search_call',id:id('ws',domain),status:'completed',action:{type:'search',query:`${name} ${domain}`,sources:[{type:'url',url:home},{type:'url',url:about}]}};
 return responseEnvelope(body,[search,message(text,annotations)],text);
}
function marketResearch(body){
 let input={};try{input=JSON.parse(typeof body.input==='string'?body.input:inputTexts(body.input)[0]);}catch{/* keep defaults */}
 const sources=['https://www.example.org/category-guide','https://www.example.net/customer-reviews'];
 const sections=body.input&&input.mode==='competitors_only'?['competitor_positioning','competitor_offers','competitor_content','competitor_visual_style']:['market_language','audience_pain','audience_desire','audience_objection','content_gap','competitor_positioning'];
 const notes=sections.map((section,i)=>({section,subject:i===0?'Category language':'',text:`Mock market note about ${section.replace(/_/g,' ')}: customers in this category value reliability, warmth and convenience.`,source_url:sources[i%sources.length]}));
 const value={notes,discovered_competitors:[{name:'Neighbourhood Rival',url:'https://www.example.net/',reason:'Serves the same local customers.'}],
  audience_suggestions:['Local professionals with busy mornings','Families looking for a weekend treat','Remote workers nearby']};
 const text=JSON.stringify(value);
 const search={type:'web_search_call',id:id('ws',text),status:'completed',action:{type:'search',query:'market research',sources:sources.map(url=>({type:'url',url}))}};
 return responseEnvelope(body,[search,message(text)],text);
}

// ---- Brand analysis -------------------------------------------------------------------
function evidenceOf(body){
 const texts=inputTexts(body.input);
 let evidence=null;for(const t of texts){try{evidence=JSON.parse(t);break;}catch{/* next */}}
 const chunks=[];
 const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(typeof v.id==='string'&&typeof v.text==='string')chunks.push(v);Object.values(v).forEach(walk);}};
 walk(evidence);
 const visuals=texts.map(t=>t.match(/^Source image ([^;]+);/)?.[1]).filter(Boolean);
 return {chunks,visuals};
}
function quoteFrom(text){
 const sentence=text.replace(/^AI [^\n]*\n/,'').split(/(?<=[.!?])\s/)[0]??text;
 const trimmed=sentence.trim().slice(0,160).trim();
 return text.includes(trimmed)&&trimmed?trimmed:text.slice(0,80);
}
/** Answers the owner gave (the guided brief chunk) are quoted exactly; otherwise a website sentence. */
function finding(field,chunks,i){
 for(const c of chunks){
  let answers;try{answers=JSON.parse(c.text);}catch{continue;}
  const value=answers?.[field]??answers?.details?.[field]??(field==='brand_name'?answers?.details?.business_name:undefined);
  if(typeof value==='string'&&value.trim()&&c.text.includes(JSON.stringify(value)))return {field,value,chunk_id:c.id,quote:value};
 }
 const prose=chunks.filter(c=>!c.text.trim().startsWith('{'));
 if(!prose.length)return null;
 const c=prose[i%prose.length],quote=quoteFrom(c.text);
 return {field,value:quote.slice(0,200),chunk_id:c.id,quote};
}
function brandAnalysis(body){
 const schema=body.text.format.schema,{chunks,visuals}=evidenceOf(body);
 const ids=chunks.map(c=>c.id);
 const fields=schema.properties.findings.items.properties.field.enum;
 const findings=chunks.length?fields.slice(0,Math.min(fields.length,8)).map((field,i)=>finding(field,chunks,i)).filter(Boolean):[];
 const value=generate(schema,schema,{key:'',index:0},{
  findings:()=>findings,missing:()=>[],
  chunk_ids:()=>ids.slice(0,1),chunk_id:()=>ids[0],evidence_ids:()=>ids.slice(0,Math.min(3,ids.length)),
  image_ids:()=>visuals.slice(0,1),visual_guidance:(s)=>visuals.length?[generate(s.items,schema,{key:'visual_guidance',index:0},{image_ids:()=>visuals.slice(0,1)})]:[],
  channels:()=>['instagram'],cadence:()=>3,
  business_direction:s=>businessDirection(s,ids),
 });
 if(value.recommendation&&!ids.length)value.recommendation=null;
 const text=JSON.stringify(value);
 return responseEnvelope(body,[message(text)],text);
}
function businessDirection(schema,ids){
 const fonts=schema.properties.heading_font.enum;
 return {summary:'A warm, dependable local brand that makes everyday moments better.',rationale:'Based on the website research and the answers you gave.',
  palette:[{role:'primary',hex:PALETTE[0]},{role:'secondary',hex:PALETTE[1]},{role:'accent',hex:PALETTE[2]}],
  heading_font:fonts[0],body_font:fonts[Math.min(1,fonts.length-1)],voice:'Warm, plain and confident.',imagery:'Natural light, real customers and products in use.',
  pillars:['Everyday rituals','Behind the scenes','Community moments'],
  starter_ideas:[{format:'static',title:'Meet the signature offer',concept:'One hero image of the signature product with a short invitation.'},{format:'carousel',title:'How it is made',concept:'Three slides from ingredients to the finished product.'}],
  essential_questions:[],evidence_ids:ids.slice(0,Math.min(3,ids.length)),
  audience_suggestions:['Local professionals with busy mornings','Families looking for a weekend treat'],competitor_gaps:['Few local competitors show their process']};
}

// ---- Skills-sandbox planner (creative briefs, plans, strategy, carousels, chat) --------
function contentPlan(schema,task){
 const variants=schema.properties.slots.items.anyOf;
 const count=schema.properties.slots.minItems;
 const pick=row=>variants.findIndex(v=>v.properties.channel.enum[0]===row.channel&&v.properties.format.enum[0]===row.format&&(!row.creative_spec||JSON.stringify(Object.keys(v.properties.creative_spec?.properties??{}))===JSON.stringify(Object.keys(row.creative_spec))&&v.properties.creative_spec?.properties?.aspect?.enum?.[0]===row.creative_spec.aspect&&v.properties.creative_spec?.properties?.placement?.enum?.[0]===row.creative_spec.placement));
 const order=task?.content_mix?.length?task.content_mix.flatMap(row=>Array.from({length:row.count},()=>Math.max(0,pick(row)))):Array.from({length:count},(_,i)=>i%variants.length);
 const start=Date.now()+86400000;
 const slots=order.slice(0,count).map((variant,index)=>{
  const slot=generate(variants[variant],schema,{key:'',index,variant:0},{reference_ids:()=>[]});
  slot.planned_at=new Date(start+index*Math.floor(28/Math.max(1,count))*86400000).toISOString().slice(0,16);
  slot.hook=`${['Start the day right','Behind the counter','Made the slow way','Meet the regulars','Your weekend plan'][index%5]} (${index+1})`;
  return slot;
 });
 const plan=generate(schema,schema,{key:'',index:0},{slots:()=>slots});
 return plan;
}
/** The Create chat's interpretation, by keyword: enough to drive every Create path deterministically. */
function chatDecision(body){
 let context={};
 for(const text of inputTexts(body.input)){try{const value=JSON.parse(text);if(value&&typeof value.message==='string')context=value;}catch{/* not the request */}}
 const message=String(context.message??''),m=message.toLowerCase();
 const channel=/linkedin/.test(m)?'linkedin':/facebook/.test(m)?'facebook':'instagram';
 const base={reply:'',action:'answer',prompt:'',channel,size:'1024x1024',sources:[],starts_on:null,text_mode:/no text|without text/.test(m)?'none':'headline',slide_count:3,placement:'feed',duration_seconds:5};
 const current=context.current_image;
 if(current&&!/carousel|campaign/.test(m)&&/change|make it|replace|regenerate|headline|brighter|warmer|swap|instead|edit|update|revise/.test(m))
  return {...base,reply:'Got it. I’ll revise the current image with that change.',action:'edit_image',prompt:message,size:current.size,channel:current.channel??channel};
 if(/carousel/.test(m)){const n=Number(m.match(/(\d+)[- ]slide/)?.[1]??3);return {...base,reply:`A ${n}-slide carousel, coming right up.`,action:'carousel',prompt:message,slide_count:Math.min(10,Math.max(2,n))};}
 if(/\bstor(y|ies)\b/.test(m))return {...base,reply:'A story, coming right up.',action:'image',prompt:message,placement:'story',size:'1024x1536',channel:channel==='linkedin'?'instagram':channel};
 if(/campaign|content plan/.test(m))return {...base,reply:'I’ll plan that campaign.',action:'campaign',prompt:message,starts_on:context.today??null};
 if(/create|make|design|post|image|\bad\b|advert/.test(m))return {...base,reply:'On it. I’m creating your post with your brand direction.',action:'image',prompt:message,size:/portrait|4:5/.test(m)?'1024x1536':/landscape/.test(m)?'1536x1024':'1024x1024'};
 return {...base,reply:'Here is an idea based on your brand.'};
}
function plannerAnswer(body){
 const format=body.text?.format,task=plannerTask(body);
 if(!format)return 'Ready.';
 const schema=format.schema;
 if(format.name==='desvio_content_plan'&&schema.properties?.slots)return JSON.stringify(contentPlan(schema,task));
 if(format.name==='desvio_chat')return JSON.stringify(chatDecision(body));
 return JSON.stringify(generate(schema,schema,{key:'',index:0},{}));
}
function planner(body){
 const text=plannerAnswer(body);
 return responseEnvelope(body,[message(text)],text);
}
function imageCheck(body){
 // The mock reports exactly the lettering the specification asks for, so checks pass deterministically.
 let expected=[];
 for(const t of inputTexts(body.input)){const at=t.indexOf('{');if(t.startsWith('SPECIFICATION')&&at>=0){try{expected=JSON.parse(t.slice(at)).expected_text??[];}catch{/* none */}}}
 const text=JSON.stringify({text_matches:true,found_text:expected.slice(0,30),brief_fit:5,brand_fit:5,artefacts:[],verdict:'pass'});
 return responseEnvelope(body,[message(text)],text);
}

export function respond(body){
 const format=body.text?.format?.name;
 const search=(body.tools??[]).some(t=>t.type==='web_search');
 if(search&&format==='market_research')return {kind:'market-research',json:marketResearch(body)};
 if(search)return {kind:'website-research',json:websiteResearch(body)};
 if(format==='brand_onboarding')return {kind:'brand-analysis',json:brandAnalysis(body)};
 if(format==='desvio_image_qa')return {kind:'image-check',json:imageCheck(body)};
 return {kind:`planner:${format??'text'}`,json:planner(body)};
}

// ---- Images ---------------------------------------------------------------------------
const escapeXml=s=>s.replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
function headlineOf(prompt){
 const found=prompt.match(/headline["'\s:]+["“]([^"”]{3,60})["”]/i)?.[1]??prompt.match(/["“]([^"”]{6,48})["”]/)?.[1];
 return (found??'Made for your mornings').trim();
}
export async function placeholderImage(prompt,size){
 const [width,height]=size.split('x').map(Number);
 const colours=[...new Set(prompt.match(/#[0-9a-fA-F]{6}\b/g)??[])].slice(0,3);
 const [a,b,c]=[colours[0]??PALETTE[0],colours[1]??PALETTE[1],colours[2]??PALETTE[2]];
 const raw=headlineOf(prompt),headline=escapeXml(raw),font=Math.round(Math.min(width/14,width*0.74/(raw.length*0.56)));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
 <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
 <rect width="100%" height="100%" fill="url(#g)"/>
 <circle cx="${width*0.78}" cy="${height*0.3}" r="${Math.min(width,height)*0.22}" fill="${c}" opacity="0.85"/>
 <rect x="${width*0.08}" y="${height*0.62}" width="${width*0.84}" height="${height*0.26}" rx="${width*0.03}" fill="${c}" opacity="0.92"/>
 <text x="${width*0.12}" y="${height*0.73}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${font}" fill="${a}">${headline}</text>
 <text x="${width*0.12}" y="${height*0.82}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(font*0.42)}" fill="${a}" opacity="0.8">Local mock image · Desvio</text>
</svg>`;
 return sharp(Buffer.from(svg)).resize(width,height).png().toBuffer();
}
function multipartFields(buffer,contentType){
 const boundary=contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.slice(1).find(Boolean);
 const fields={};if(!boundary)return fields;
 for(const part of buffer.toString('latin1').split(`--${boundary}`)){
  const name=part.match(/name="([^"]+)"/)?.[1];
  if(!name||/filename="/.test(part))continue;
  const at=part.indexOf('\r\n\r\n');if(at<0)continue;
  fields[name]=Buffer.from(part.slice(at+4).replace(/\r\n$/,''),'latin1').toString('utf8');
 }
 return fields;
}
async function imageResponse(fields){
 // Answer the size that was asked for (including 2K masters), within sane bounds, like the real API.
 const asked=/^(\d{3,4})x(\d{3,4})$/.exec(String(fields.size??'')),fits=asked&&[asked[1],asked[2]].every(n=>Number(n)>=256&&Number(n)<=4096);
 const size=fits?fields.size:'1024x1024';
 const png=await placeholderImage(fields.prompt??'',size);
 return {created:Math.floor(Date.now()/1000),data:[{b64_json:png.toString('base64')}],output_format:'png',size,quality:fields.quality??'low',
  usage:{input_tokens:100,input_tokens_details:{text_tokens:100,image_tokens:0},output_tokens:1000,total_tokens:1100}};
}

/** Starts the mock on 127.0.0.1:`port`. `log` receives one line per request. */
export function startMockProviders(port,log=()=>{}){
 const counts={};
 const server=createServer(async(req,res)=>{
  const send=(status,json)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(json));};
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&url.pathname==='/health')return send(200,{ok:true,counts});
   const raw=await readBody(req);
   let kind,json;
   if(req.method==='POST'&&url.pathname==='/v1/responses'){({kind,json}=respond(JSON.parse(raw.toString('utf8'))));}
   else if(req.method==='POST'&&url.pathname==='/v1/images/generations'){kind='image-generate';json=await imageResponse(JSON.parse(raw.toString('utf8')));}
   else if(req.method==='POST'&&url.pathname==='/v1/images/edits'){kind='image-edit';json=await imageResponse(multipartFields(raw,req.headers['content-type']??''));}
   else{log(`mock: no handler for ${req.method} ${url.pathname}`);return send(404,{error:{message:'Not mocked',type:'invalid_request_error'}});}
   counts[kind]=(counts[kind]??0)+1;log(`mock: ${kind}`);
   return send(200,json);
  }catch(error){
   log(`mock: request failed: ${error instanceof Error?error.message:'unknown error'}`);
   return send(500,{error:{message:'Mock provider could not answer this request',type:'server_error'}});
  }
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve({server,counts,close:()=>new Promise(r=>server.close(r))}));});
}
