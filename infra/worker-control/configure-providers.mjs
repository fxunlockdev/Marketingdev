// One-shot dev administration. No administrator credential enters a running service.
import {execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {configurationManifest} from '../../scripts/configure-providers.mjs';

const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12';
const environment='6a760b10-9ed8-4f01-9c4a-77a25919755a';
const database='758bf0c1-56b5-452f-be8d-fe67af927267';
const root=new URL('../../',import.meta.url);
const deny=()=>{throw Error('PROVIDER_SETUP_INVALID_INPUT');};
export function setupArguments(args){
 const [file,flag,approval,...extra]=args;
 if(!file||extra.length||flag!==undefined&&(flag!=='--apply'||!approval)||approval&&!/^[a-f0-9]{64}$/.test(approval)||file==='--list'&&flag)deny();
 return {file,approval};
}
export function setupTarget(host,inventory){
 if(host.project_id!==project||host.environment_id!==environment||! /^[a-f0-9-]{36}$/.test(host.id))deny();
 const image=inventory.images?.find(x=>x.role==='trusted_worker')?.image_id;
 if(!/^sha256:[a-f0-9]{64}$/.test(image??''))deny();
 return {project,environment,sandbox:host.id,image};
}
export async function setupPayload(connectionString,manifest,approval){
 const u=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.username||!u.password||!u.hostname||u.pathname.length<2)deny();
 if(manifest)configurationManifest(manifest);
 if(approval&&!/^[a-f0-9]{64}$/.test(approval)||!manifest&&approval)deny();
 const migrations={};
 for(const name of (await readdir(new URL('database/migrations/',root))).sort()){
  if(/^\d+_.+\.sql$/.test(name))migrations[name]=await readFile(new URL('database/migrations/'+name,root),'utf8');
 }
 return {connectionString,expectedDatabase:decodeURIComponent(u.pathname.slice(1)),manifest,approval,
  source:await readFile(new URL('scripts/configure-providers.mjs',root),'utf8'),migrations};
}

// Input travels only over stdin. Code and migration checksums are from this checkout;
// temp files contain no credentials and live only on the one-shot container's tmpfs.
export const setupRunner=String.raw`
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
let directory,pool;
try {
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2000000)throw Error();}
 const input=JSON.parse(raw);
 directory=await mkdtemp(join(tmpdir(),'desvio-provider-'));
 await mkdir(join(directory,'scripts'));await mkdir(join(directory,'database','migrations'),{recursive:true});
 await symlink(join(process.cwd(),'node_modules'),join(directory,'node_modules'));
 await writeFile(join(directory,'scripts','configure-providers.mjs'),input.source,{mode:0o600});
 for(const [name,sql] of Object.entries(input.migrations)){
  if(!/^\d+_[a-zA-Z0-9_-]+\.sql$/.test(name))throw Error();
  await writeFile(join(directory,'database','migrations',name),sql,{mode:0o600});
 }
 const {inspectConfiguration,configureProviders}=await import(pathToFileURL(join(directory,'scripts','configure-providers.mjs')));
 pool=new Pool({connectionString:input.connectionString,max:1,connectionTimeoutMillis:10000,statement_timeout:30000});
 const options={mode:'staging',expectedDatabase:input.expectedDatabase,approval:input.approval};
 const result=input.manifest?await configureProviders(pool,input.manifest,options):await inspectConfiguration(pool,options);
 console.log(JSON.stringify(result));
}catch(e){console.error(/^CONFIGURATION_[A-Z_]+$/.test(e.code??'')?e.code:'PROVIDER_SETUP_FAILED');process.exitCode=1;}
finally{await pool?.end();if(directory)await rm(directory,{recursive:true,force:true});}
`;

export function setupCommand(image){
 if(!/^sha256:[a-f0-9]{64}$/.test(image))deny();
 const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
 return 'docker run --rm -i --network host --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 1 --tmpfs /tmp:rw,noexec,nosuid,size=16m '+image+' node --input-type=module -e '+quote(setupRunner);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {file,approval}=setupArguments(process.argv.slice(2));
  const host=JSON.parse(await readFile(new URL('work/railway-worker-host.json',root)));
  const target=setupTarget(host,JSON.parse(await readFile(new URL('docs/evidence/worker-image-inventory.json',root))));
  let manifest=null;
  if(file!=='--list'){const raw=await readFile(file);if(raw.length>64000)deny();manifest=JSON.parse(raw);configurationManifest(manifest);}
  const env={...process.env,RAILWAY_CALLER:'skill:use-railway@1.7.0',RAILWAY_AGENT_SESSION:'desvio-provider-setup'};
  const vars=JSON.parse(execFileSync('railway',['variables','--project',project,'--environment',environment,'--service',database,'--json'],{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
  const payload=await setupPayload(vars.DATABASE_URL,manifest,approval);
  const output=execFileSync('railway',['sandbox','exec','--id',target.sandbox,'--project',project,'--environment',environment,'--timeout','60','--',setupCommand(target.image)],{env,input:JSON.stringify(payload),encoding:'utf8',timeout:70000,maxBuffer:2000000,stdio:['pipe','pipe','pipe']});
  const result=JSON.parse(output);
  if(manifest?!['preview','applied','already_applied'].includes(result.status):!Array.isArray(result.businesses)||!Array.isArray(result.channels))throw Error();
  await writeFile(new URL('docs/evidence/railway-provider-setup.json',root),JSON.stringify({checked_at:new Date().toISOString(),passed:true,...target,
   operation:manifest?approval?'apply':'preview':'list',result:result.status??'listed',
   business_count:result.businesses?.length,channel_count:result.channels?.length,
   operator_source_sha256:createHash('sha256').update(payload.source).digest('hex'),
   paid_calls:false,scope:'One-shot dev administrator transport and checksum-verified configuration only; no model eligibility, pricing, generation, social connectivity or launch readiness proof.'},null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
 }catch(e){
  const safe=e.stderr?.toString().match(/(?:CONFIGURATION|PROVIDER_SETUP)_[A-Z_]+/g)?.at(-1);
  console.error(safe??(/^CONFIGURATION_[A-Z_]+$/.test(e.code??'')?e.code:'PROVIDER_SETUP_FAILED_RECONCILE'));
  process.exitCode=1;
 }
}
