import {BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Canvas} from './canvas.js';
import {Planning} from './planning.js';
import {canonicalJSON,hash} from './brand-brain.js';
import {approvedLearning} from './learning-context.js';
import {localMinute} from './local-calendar.js';
import {object,uuid} from './workspaces.js';
import {CHAT_MODEL,validateChatDecision} from './chat-contracts.js';
const active=['queued','running','retrying','unknown'];
const recallTerms=(message:string)=>[...new Set((message.toLowerCase().match(/[a-z0-9]{3,}/g)??[]).filter(w=>!new Set(['the','and','for','that','this','with','remember','created','create','campaign','post','image','about','from','you','our','was','were','had','have','did','what','please','can','show']).has(w)))].slice(0,16).join(' | ')||'__no_recall_terms__';
export class ChatConversations {
 constructor(readonly canvas:Canvas,readonly planning:Planning){}
 outbox(user:string,brand:string){return this.canvas.scope(user,brand,false,async db=>({request:(await db.query('SELECT request_key AS key,body FROM app.chat_outbox')).rows[0]??null}));}
 saveOutbox(user:string,brand:string,body:unknown){
  const v=object(body,['key','body']),value=object(v.body,['conversation_id','message']);
  if(typeof v.key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(v.key)||typeof value.message!=='string'||!value.message.trim()||value.message.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.message))throw new BadRequestException('Enter a message and a request key');
  const envelope={conversation_id:value.conversation_id?uuid(String(value.conversation_id)):null,message:value.message.trim()};
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chat:${brand}:${user}`]);
   const prior=(await db.query('SELECT request_key AS key,body FROM app.chat_outbox')).rows[0];
   if(prior){if(prior.key!==v.key||canonicalJSON(prior.body)!==canonicalJSON(envelope))throw new ConflictException('A saved message still needs to finish sending. Reopen this chat to resume it.');return prior;}
   if(envelope.conversation_id)await this.own(db,envelope.conversation_id);
   await db.query('INSERT INTO app.chat_outbox(organization_id,brand_id,actor_id,request_key,body) VALUES($1,$2,$3,$4,$5)',[b.organization_id,brand,user,v.key,JSON.stringify(envelope)]);
   return {key:v.key,body:envelope};
  });
 }
 discard(user:string,brand:string,key:string){return this.canvas.scope(user,brand,true,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chat:${brand}:${user}`]);
  if((await db.query('SELECT t.job_id FROM app.chat_turns t JOIN app.planning_requests r ON r.job_id=t.job_id WHERE r.request_key=$1',[`chat:${key}`])).rowCount)throw new ConflictException('This message was already accepted. Resume it to see its saved result.');
  await db.query('DELETE FROM app.chat_outbox WHERE request_key=$1',[key]);return {discarded:true};
 });}
 acknowledge(user:string,brand:string,key:string){return this.canvas.scope(user,brand,true,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chat:${brand}:${user}`]);
  if(!(await db.query(`SELECT t.job_id FROM app.chat_turns t JOIN app.planning_requests r ON r.job_id=t.job_id WHERE r.request_key=$1`,[`chat:${key}`])).rowCount)throw new ConflictException('This message has not been saved yet. Retry the original message.');
  await db.query('DELETE FROM app.chat_outbox WHERE request_key=$1',[key]);return {saved:true};
 });}
 list(user:string,brand:string,query=''){
  if(query.length>200)throw new BadRequestException('Search is too long');
  return this.canvas.scope(user,brand,false,async db=>({conversations:(await db.query(`SELECT c.id,c.title,c.created_at,c.updated_at FROM app.chat_conversations c WHERE ($1='' OR position(lower($1) in lower(c.title))>0 OR EXISTS(SELECT 1 FROM app.chat_turns t WHERE t.conversation_id=c.id AND position(lower($1) in lower(t.message))>0)) ORDER BY c.updated_at DESC,c.id LIMIT 100`,[query.trim()])).rows}));
 }
 async own(db:any,id:string){const c=(await db.query('SELECT * FROM app.chat_conversations WHERE id=$1',[id])).rows[0];if(!c)throw new NotFoundException('Conversation not found');return c;}
 read(user:string,brand:string,id:string){id=uuid(id);return this.canvas.scope(user,brand,false,async db=>{
  const conversation=await this.own(db,id);
  const turns=(await db.query(`SELECT t.job_id AS id,t.message,t.created_at,t.action_result,j.status,j.error_code,a.status AS action_status,a.error_code AS action_error,r.output,r.input->'chat'->'memories' AS source_records FROM app.chat_turns t JOIN app.jobs j ON j.id=t.job_id JOIN app.planning_requests r ON r.job_id=t.job_id LEFT JOIN delivery.chat_actions a ON a.job_id=t.job_id WHERE t.conversation_id=$1 ORDER BY t.created_at,t.job_id LIMIT 150`,[id])).rows;
  // Saved versions are the durable chat attachment. No second write or retry-created message.
  const saved_images=(await db.query(`SELECT v.id,v.project_id,v.design,v.created_at,
    (SELECT count(*)::int FROM app.creative_versions prior WHERE prior.project_id=v.project_id AND (prior.created_at,prior.id)<=(v.created_at,v.id)) AS version_number
    FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id
    WHERE p.thread_id=$1 AND v.organization_id=$2 AND v.brand_id=$3
      AND v.job_id IS NULL AND v.parent_id IS NOT NULL
    ORDER BY v.created_at,v.id`,[id,conversation.organization_id,brand])).rows;
  return {conversation:{id:conversation.id,title:conversation.title},saved_images,turns:turns.map(({source_records,...t}:any)=>({...t,sources:(source_records??[]).filter((s:any)=>t.output?.sources?.includes(s.id)).map((s:any)=>({id:s.id,title:s.title,kind:s.kind??'conversation'}))}))};
 });}
 submit(user:string,brand:string,body:unknown,key:unknown){
  const v=object(body,['conversation_id','message']);
  if(typeof v.message!=='string'||!v.message.trim()||v.message.length>4000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v.message)||typeof key!=='string'||! /^[A-Za-z0-9_.:-]{8,128}$/.test(key))throw new BadRequestException('Use a message of 1–4000 characters and a request key');
  const conversation=v.conversation_id?uuid(String(v.conversation_id)):null,message=v.message.trim(),fingerprint=hash(canonicalJSON({user,conversation,message}));
  return this.canvas.scope(user,brand,true,async(db,b)=>{
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chat:${brand}:${user}`]);
   const prior=(await db.query(`SELECT t.job_id AS id,t.conversation_id,r.request_hash FROM app.chat_turns t JOIN app.planning_requests r ON r.job_id=t.job_id WHERE r.request_key=$1`,[`chat:${key}`])).rows[0];
   if(prior){if(prior.request_hash!==fingerprint)throw new ConflictException('This request key belongs to a different message');return {id:prior.id,conversation_id:prior.conversation_id};}
   const pending=(await db.query('SELECT request_key,body FROM app.chat_outbox')).rows[0];
   if(!pending||pending.request_key!==key||canonicalJSON(pending.body)!==canonicalJSON({conversation_id:conversation,message}))throw new ConflictException('Save this message before sending it. The previous unsent message may have been discarded.');
   if(conversation)await this.own(db,conversation);
   if((await db.query("SELECT job_id FROM delivery.chat_actions WHERE status='queued'")).rowCount)throw new ConflictException('Your previous creative is being prepared. Wait for it before another instruction.');
   if((await db.query(`SELECT t.job_id FROM app.chat_turns t JOIN app.jobs j ON j.id=t.job_id WHERE j.status=ANY($1::text[])`,[active])).rowCount)throw new ConflictException('Your previous message is still processing or needs attention. Reopen it in History.');
   if((await db.query("SELECT count(*)::int AS n FROM app.chat_turns WHERE created_at>now()-interval '1 day'")).rows[0].n>=100)throw new ConflictException('Daily conversation limit reached. Your history is saved.');
   const previous=conversation?(await db.query(`SELECT t.message,j.status,r.output,t.action_result FROM app.chat_turns t JOIN app.jobs j ON j.id=t.job_id JOIN app.planning_requests r ON r.job_id=t.job_id WHERE t.conversation_id=$1 ORDER BY t.created_at DESC,t.job_id DESC LIMIT 12`,[conversation])).rows.reverse():[];
   if(conversation&&(await db.query('SELECT count(*)::int AS n FROM app.chat_turns WHERE conversation_id=$1',[conversation])).rows[0].n>=150)throw new ConflictException('Start a new conversation; this one remains in History.');
   const brain=(await db.query('SELECT id,sha256,snapshot FROM app.brand_brain_versions ORDER BY approved_at DESC,id LIMIT 1')).rows[0];
   if(!brain||hash(canonicalJSON(brain.snapshot))!==brain.sha256)throw new ConflictException('Confirm your brand knowledge before creating with chat.');
   const prefs=(await db.query('SELECT timezone,channels FROM app.business_onboarding LIMIT 1')).rows[0];
   const grant=(await db.query("SELECT model FROM app.planning_grants WHERE provider='openai' AND enabled AND expires_at>now() LIMIT 1")).rows[0];
   if(!grant)throw new ConflictException('AI conversations are not enabled for this business yet.');
   // Search private transcripts and business campaigns separately. Retrieved text is untrusted evidence.
   const memories=(await db.query(`SELECT c.id,c.title,c.updated_at,(SELECT jsonb_agg(x) FROM (SELECT t.message,j.status,left(r.output->>'reply',800) AS reply FROM app.chat_turns t JOIN app.jobs j ON j.id=t.job_id JOIN app.planning_requests r ON r.job_id=t.job_id WHERE t.conversation_id=c.id ORDER BY t.created_at DESC LIMIT 2)x) AS recent FROM app.chat_conversations c WHERE c.id IS DISTINCT FROM $1 ORDER BY (CASE WHEN (to_tsvector('simple',c.title) @@ to_tsquery('simple',$2) OR EXISTS(SELECT 1 FROM app.chat_turns mt WHERE mt.conversation_id=c.id AND to_tsvector('simple',mt.message) @@ to_tsquery('simple',$2))) THEN 1 ELSE 0 END) DESC,c.updated_at DESC LIMIT 12`,[conversation,recallTerms(message)])).rows;
   const campaigns=(await db.query(`SELECT id,title,starts_on::text,duration_days,created_at FROM app.content_plans ORDER BY (CASE WHEN to_tsvector('simple',title) @@ to_tsquery('simple',$1) THEN 1 ELSE 0 END) DESC,created_at DESC LIMIT 20`,[recallTerms(message)])).rows.map((p:any)=>({...p,kind:'campaign'}));
   const currentImage=conversation?(await db.query(`SELECT v.id,p.id AS project_id,CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(v.design->'layers') layer WHERE length(trim(layer->>'text'))>0) THEN 'headline' ELSE 'none' END AS text_mode,CASE WHEN v.skill_manifest->'creative_spec'->>'aspect' IN ('portrait','vertical') THEN '1024x1536' WHEN v.skill_manifest->'creative_spec'->>'aspect'='landscape' THEN '1536x1024' ELSE m.width::text||'x'||m.height::text END AS size,r.channel,v.skill_manifest->'creative_spec' AS creative_spec FROM app.creative_projects p JOIN app.creative_versions v ON v.id=p.latest_version_id JOIN app.creative_media m ON m.id=v.media_id LEFT JOIN LATERAL(SELECT channel FROM app.creative_requests WHERE project_id=p.id ORDER BY output_version_id IS NOT NULL DESC,job_id LIMIT 1)r ON true WHERE p.thread_id=$1 AND p.archived_at IS NULL ORDER BY v.created_at DESC LIMIT 1`,[conversation])).rows[0]??null:null;
   if(conversation&&(await db.query(`SELECT j.id FROM app.creative_requests r JOIN app.jobs j ON j.id=r.job_id WHERE r.thread_id=$1 AND j.status=ANY($2::text[])`,[conversation,active])).rowCount)throw new ConflictException('Your image is still generating or needs attention. Wait for its result before another edit.');
   const input={task:'content_plan',brand:{id:brain.id,sha256:brain.sha256,facts:brain.snapshot.facts.map((f:any)=>({id:f.id,field:f.field,value:f.value})),learning:await approvedLearning(db)},chat:{message,previous,memories:[...memories,...campaigns],current_image:currentImage,timezone:prefs?.timezone??'UTC',today:localMinute(Date.now(),prefs?.timezone??'UTC').slice(0,10)}};
   if(Buffer.byteLength(JSON.stringify(input))>90000)throw new ConflictException('This conversation has too much context. Start a new chat; the previous chat stays in History.');
   const id=conversation??(await this.canvas.createThread(user,brand,{title:message.slice(0,140)},`chat:${key}`,{db,b})).id;
   if(!conversation)await db.query('INSERT INTO app.chat_conversations(id,organization_id,brand_id,actor_id,title) VALUES($1,$2,$3,$4,$5)',[id,b.organization_id,brand,user,message.slice(0,140)]);
   const job=randomUUID();await db.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind) VALUES($1,$2,$3,$4,'plan.generate')",[job,b.organization_id,brand,user]);
   await db.query("INSERT INTO app.planning_requests(job_id,organization_id,brand_id,brain_id,input,input_sha256,request_key,request_hash,provider,selected_model,thread_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'openai',$9,$10)",[job,b.organization_id,brand,brain.id,JSON.stringify(input),hash(canonicalJSON(input)),`chat:${key}`,fingerprint,CHAT_MODEL,id]);
   await db.query('INSERT INTO app.chat_turns(job_id,organization_id,brand_id,conversation_id,actor_id,message) VALUES($1,$2,$3,$4,$5,$6)',[job,b.organization_id,brand,id,user,message]);
   await db.query('UPDATE app.chat_conversations SET updated_at=now() WHERE id=$1',[id]);
   await db.query("INSERT INTO app.job_dispatch(job_id,organization_id,brand_id,kind) VALUES($1,$2,$3,'plan.generate')",[job,b.organization_id,brand]);
   return {id:job,conversation_id:id};
  });
 }
 execute(user:string,brand:string,turnId:string){turnId=uuid(turnId);return this.canvas.scope(user,brand,true,async(db,b)=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`chat:${brand}:${user}`]);
  const turn=(await db.query('SELECT t.*,r.output,r.input,j.status FROM app.chat_turns t JOIN app.planning_requests r ON r.job_id=t.job_id JOIN app.jobs j ON j.id=t.job_id WHERE t.job_id=$1 FOR UPDATE OF t',[turnId])).rows[0];
  if(!turn)throw new NotFoundException('Message not found');
  if(turn.action_result)return turn.action_result;
  if(turn.status!=='succeeded')throw new ConflictException('Wait for the assistant to finish interpreting this message.');
  const latest=(await db.query('SELECT job_id FROM app.chat_turns WHERE conversation_id=$1 ORDER BY created_at DESC,job_id DESC LIMIT 1',[turn.conversation_id])).rows[0];
  if(latest.job_id!==turnId)throw new ConflictException('This is an earlier request. Continue from the latest message.');
  const decision=validateChatDecision(turn.output,turn.input.chat);let result:any;
  if(['image','edit_image'].includes(decision.action)){
   const parent=decision.action==='edit_image'?turn.input.chat.current_image:null;
   const spec={...(parent?.creative_spec??{placement:'feed',aspect:(parent?.size??decision.size)==='1024x1024'?'square':(parent?.size??decision.size)==='1536x1024'?'landscape':'portrait',slide_count:null}),artwork:{...parent?.creative_spec?.artwork,text:decision.text_mode}};
   result=await this.canvas.submit(user,brand,turn.conversation_id,{prompt:decision.prompt,format:'static',channel:parent?.channel??decision.channel,size:parent?.size??decision.size,parent_version_id:parent?.id??null,creative_spec:spec},`chat-action:${turnId}`,{db,b});
   result={...result,kind:'image'};
  }else if(decision.action==='campaign'){
   result=await this.planning.submit(user,brand,{provider:'openai',brief:decision.prompt,starts_on:decision.starts_on,canvas_thread_id:turn.conversation_id,planning_mode:'natural'},`chat-action:${turnId}`,{db,b,budgetMicros:0,weeklyIncrease:0,single:true});
   result={...result,kind:'campaign'};
  }else throw new BadRequestException('This message does not authorize image or campaign generation.');
  await db.query('UPDATE app.chat_turns SET action_result=$2 WHERE job_id=$1',[turnId,JSON.stringify(result)]);
  await db.query("UPDATE delivery.chat_actions SET status='completed',error_code=NULL WHERE job_id=$1",[turnId]);return result;
 });}
}
