// One-shot staging administration. Never import into customer or provider services.
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';

export class ConfigurationError extends Error {constructor(code){super(code);this.code=code;}}
const deny=code=>{throw new ConfigurationError(code);};
const canonical=v=>v instanceof Date?JSON.stringify(v.toISOString()):v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const uuid=v=>{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))deny('CONFIGURATION_EXACT_ID_REQUIRED');return v.toLowerCase();};
const object=(v,keys)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!keys.includes(k)))deny('CONFIGURATION_UNKNOWN_FIELD');return v;};
const number=(v,max,integer=true)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>max||integer&&!Number.isSafeInteger(v))deny('CONFIGURATION_INVALID_AMOUNT');return v;};
const model=v=>{if(typeof v!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(v))deny('CONFIGURATION_INVALID_MODEL');return v;};
const textRates=['budget_micros','input_micros_per_token','output_micros_per_token'];
const definitions={
 onboarding:{table:'analysis_grants',fields:['model',...textRates]},
 creative:{table:'creative_grants',fields:['text_model','image_model','quality',...textRates,'max_image_request_micros']},
 gemini_creative:{table:'gemini_creative_grants',fields:['text_model',...textRates]},
 planning:{table:'planning_grants',fields:['provider','model',...textRates],key:'provider'},
 insights:{table:'insight_grants',fields:['provider','model',...textRates],key:'provider'},
 video:{table:'video_grants',fields:['models','budget_micros','max_create_micros','max_edit_micros']},
 publishing:{table:'publication_grants',fields:['channel_id','remote_account_id','daily_limit'],key:'channel_id'},
};
export function configurationManifest(input,now=Date.now()){
 const v=object(input,['version','change_id','organization_id','business_id','operator_reference','grants']);
 if(v.version!==1||typeof v.operator_reference!=='string'||!v.operator_reference.trim()||v.operator_reference.length>500||/[\x00-\x1f\x7f]/.test(v.operator_reference))deny('CONFIGURATION_INVALID_MANIFEST');
 if(!Array.isArray(v.grants)||!v.grants.length||v.grants.length>12)deny('CONFIGURATION_INVALID_GRANTS');
 const seen=new Set();
 const grants=v.grants.map(raw=>{
  const d=Object.hasOwn(definitions,raw?.kind)?definitions[raw.kind]:null;if(!d)deny('CONFIGURATION_UNKNOWN_CAPABILITY');
  const g={...object(raw,['kind','enabled','expires_at',...d.fields])};
  if(typeof g.enabled!=='boolean'||typeof g.expires_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(g.expires_at)||!Number.isFinite(Date.parse(g.expires_at))||Date.parse(g.expires_at)<=now||Date.parse(g.expires_at)>now+31*86400000)deny('CONFIGURATION_EXPIRY_REQUIRED');
  if(new Date(g.expires_at).toISOString()!==g.expires_at.replace(/(?<!\.\d{3})Z$/,'.000Z'))deny('CONFIGURATION_EXPIRY_REQUIRED');
  g.expires_at=new Date(g.expires_at).toISOString();
  for(const field of d.fields){
   if(field==='provider'){if(!['openai','gemini'].includes(g[field]))deny('CONFIGURATION_INVALID_PROVIDER');}
   else if(['model','text_model','image_model'].includes(field))model(g[field]);
   else if(field==='quality'){if(!['low','medium','high'].includes(g[field]))deny('CONFIGURATION_INVALID_QUALITY');}
   else if(field==='models'){if(!Array.isArray(g.models)||!g.models.length||g.models.length>2||new Set(g.models).size!==g.models.length||g.models.some(m=>!['kling-video/v3.0/std/image-to-video','kling-video/o3/video-edit'].includes(m)))deny('CONFIGURATION_INVALID_VIDEO_MODEL');g.models=[...g.models].sort();}
   else if(field==='channel_id')g.channel_id=uuid(g.channel_id);
   else if(field==='remote_account_id'){if(typeof g[field]!=='string'||! /^[a-zA-Z0-9_-]{1,256}$/.test(g[field]))deny('CONFIGURATION_EXACT_ACCOUNT_REQUIRED');}
   else number(g[field],field==='daily_limit'?100:field==='budget_micros'?1e9:field.endsWith('_per_token')?1000:1e8,!field.endsWith('_per_token'));
  }
  if((g.kind==='gemini_creative'||g.provider==='gemini')&&!/^gemini-[a-zA-Z0-9._-]{1,90}$/.test(g.text_model??g.model))deny('CONFIGURATION_INVALID_GEMINI_MODEL');
  for(const k of ['max_image_request_micros','max_create_micros','max_edit_micros'])if(g[k]>g.budget_micros)deny('CONFIGURATION_CALL_CAP_EXCEEDS_BUDGET');
  const key=g.kind+':'+(d.key?g[d.key]:'');if(seen.has(key))deny('CONFIGURATION_DUPLICATE_GRANT');seen.add(key);return g;
 }).sort((a,b)=>(a.kind+':'+(a.provider??a.channel_id??'')).localeCompare(b.kind+':'+(b.provider??b.channel_id??'')));
 return {version:1,change_id:uuid(v.change_id),organization_id:uuid(v.organization_id),business_id:uuid(v.business_id),operator_reference:v.operator_reference,grants};
}
async function verifyTarget(db,{mode,expectedDatabase}){
 if(!['test','development','staging'].includes(mode))deny('CONFIGURATION_MODE_DENIED');
 if(!expectedDatabase)deny('CONFIGURATION_TARGET_REQUIRED');
 const target=(await db.query('SELECT current_database() AS name,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(target.name!==expectedDatabase)deny('CONFIGURATION_DATABASE_MISMATCH');
 if(!target.rolsuper)deny('CONFIGURATION_ADMINISTRATOR_REQUIRED');
 const directory=new URL('../database/migrations/',import.meta.url);
 const applied=new Map((await db.query('SELECT name,sha256 FROM desvio_migrations.applied')).rows.map(r=>[r.name,r.sha256]));
 const names=(await readdir(directory)).filter(n=>/^\d+_.+\.sql$/.test(n));
 if(applied.size!==names.length)deny('CONFIGURATION_SCHEMA_MISMATCH');
 for(const name of names)if(applied.get(name)!==createHash('sha256').update(await readFile(new URL(name,directory))).digest('hex'))deny('CONFIGURATION_SCHEMA_MISMATCH');
}
export async function inspectConfiguration(pool,options){
 const db=await pool.connect();
 try{
  await db.query('BEGIN READ ONLY');await verifyTarget(db,options);
  const businesses=(await db.query('SELECT organization_id,id AS business_id,name FROM app.brands ORDER BY organization_id,id')).rows;
  const channels=(await db.query('SELECT organization_id,brand_id AS business_id,id AS channel_id,name,provider,remote_id AS remote_account_id,observed_state FROM app.social_channels ORDER BY organization_id,brand_id,id')).rows;
  await db.query('COMMIT');return {businesses,channels};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e instanceof ConfigurationError?e:new ConfigurationError('CONFIGURATION_INSPECTION_FAILED');}finally{db.release();}
}
export async function configureProviders(pool,input,{expectedDatabase,approval,mode}={}){
 if(!['test','development','staging'].includes(mode))deny('CONFIGURATION_MODE_DENIED');
 if(!expectedDatabase)deny('CONFIGURATION_TARGET_REQUIRED');
 const manifest=configurationManifest(input),manifestHash=digest(manifest),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='30s'");
  await verifyTarget(db,{mode,expectedDatabase});
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`members:${manifest.organization_id}`]);
  const business=(await db.query('SELECT id,name FROM app.brands WHERE organization_id=$1 AND id=$2',[manifest.organization_id,manifest.business_id])).rows[0];
  if(!business)deny('CONFIGURATION_BUSINESS_MISMATCH');
  const prior=(await db.query('SELECT manifest_sha256,preview_sha256 FROM app.operator_configuration_changes WHERE change_id=$1',[manifest.change_id])).rows[0];
  if(prior){if(prior.manifest_sha256!==manifestHash)deny('CONFIGURATION_CHANGE_ID_REUSED');if(approval&&approval!==prior.preview_sha256)deny('CONFIGURATION_APPROVAL_MISMATCH');await db.query('COMMIT');return {status:'already_applied',change_id:manifest.change_id,preview_sha256:prior.preview_sha256};}
  const snapshots=[];
  for(const g of manifest.grants){
   const d=definitions[g.kind],args=[manifest.organization_id,manifest.business_id,...(d.key?[g[d.key]]:[])];
   const existing=(await db.query(`SELECT * FROM app.${d.table} WHERE organization_id=$1 AND brand_id=$2${d.key?` AND ${d.key}=$3`:''}`,args)).rows[0]??null;
   let account=null;
   if(g.kind==='publishing'){
    account=(await db.query('SELECT c.id,c.name,c.remote_id,c.provider,c.observed_state,c.account_revision,a.revision,a.enabled,a.identity_verified_at FROM app.social_channels c JOIN app.postiz_accounts a ON a.organization_id=c.organization_id AND a.brand_id=c.brand_id WHERE c.organization_id=$1 AND c.brand_id=$2 AND c.id=$3',args)).rows[0];
    if(!account||account.remote_id!==g.remote_account_id||account.provider!=='linkedin'||g.enabled&&(!account.enabled||!account.identity_verified_at||account.account_revision!==account.revision||account.observed_state!=='available'))deny('CONFIGURATION_ACCOUNT_MISMATCH');
   }
   snapshots.push({kind:g.kind,key:d.key?g[d.key]:null,existing,account});
  }
  const previewHash=digest({manifest,snapshots});
  if(!approval){await db.query('ROLLBACK');return {status:'preview',preview_sha256:previewHash,business,manifest,scope:'Grant configuration only; no provider keys, model eligibility, deployment or live verification is implied.'};}
  if(approval!==previewHash)deny('CONFIGURATION_PREVIEW_STALE');
  for(const g of manifest.grants){
   const d=definitions[g.kind],data={organization_id:manifest.organization_id,brand_id:manifest.business_id};
   for(const field of d.fields)if(field!=='remote_account_id')data[field]=g[field];
   data.expires_at=g.kind==='publishing'&&!g.enabled?new Date(0).toISOString():g.expires_at;
   if(g.kind!=='publishing')data.enabled=g.enabled;
   data[['publishing','video'].includes(g.kind)?'operator_reference':'approved_by']=manifest.operator_reference;
   const keys=['organization_id','brand_id',...(d.key?[d.key]:[])],columns=Object.keys(data);
   const updates=columns.filter(k=>!keys.includes(k)).map(k=>`${k}=EXCLUDED.${k}`);
   if(!['publishing','video','insights'].includes(g.kind))updates.push('approved_at=now()');
   await db.query(`INSERT INTO app.${d.table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(${keys.join(',')}) DO UPDATE SET ${updates.join(',')}`,Object.values(data));
  }
  await db.query('INSERT INTO app.operator_configuration_changes(change_id,organization_id,brand_id,manifest_sha256,preview_sha256,operator_reference,configuration) VALUES($1,$2,$3,$4,$5,$6,$7)',[manifest.change_id,manifest.organization_id,manifest.business_id,manifestHash,previewHash,manifest.operator_reference,JSON.stringify({manifest,before:snapshots})]);
  await db.query('COMMIT');return {status:'applied',change_id:manifest.change_id,preview_sha256:previewHash,grants:manifest.grants.length};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e instanceof ConfigurationError)throw e;throw new ConfigurationError('CONFIGURATION_FAILED_ROLLED_BACK');}finally{db.release();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let pool;
 try{
  const [file,flag,approval,...extra]=process.argv.slice(2);
  if(!file||extra.length||flag!==undefined&&(flag!=='--apply'||!approval)||approval&&!/^[a-f0-9]{64}$/.test(approval))deny('CONFIGURATION_USAGE_MANIFEST_OPTIONAL_APPLY_SHA256');
  const raw=file==='--list'?null:await readFile(file);if(raw&&raw.length>64000)deny('CONFIGURATION_MANIFEST_TOO_LARGE');
  if(!process.env.MIGRATION_DATABASE_URL)deny('CONFIGURATION_ADMIN_URL_REQUIRED');
  pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1});
  const options={expectedDatabase:process.env.DESVIO_DATABASE_NAME,mode:process.env.APP_MODE,approval};
  if(file==='--list'&&flag)deny('CONFIGURATION_USAGE_MANIFEST_OPTIONAL_APPLY_SHA256');
  console.log(JSON.stringify(file==='--list'?await inspectConfiguration(pool,options):await configureProviders(pool,JSON.parse(raw.toString()),options),null,2));
 }catch(e){console.error(e instanceof ConfigurationError?e.code:'CONFIGURATION_INPUT_OR_CONNECTION_FAILED');process.exitCode=1;}finally{await pool?.end();}
}
