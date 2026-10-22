import {spawn} from 'node:child_process';
import {cp,mkdir,writeFile,stat,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
const api=process.env.API_ORIGIN;
try{const u=new URL(api);if(u.origin!==api||u.username||u.password||!['http:','https:'].includes(u.protocol))throw new Error();}catch{throw new Error('API_ORIGIN must be an exact server origin at build time');}
const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build','apps/web','--webpack'],{stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',DESVIO_STANDALONE:'true'}});child.once('error',reject);child.once('exit',resolve);});
if(code!==0)process.exit(code??1);
const root=resolve('apps/web/.next/standalone');
await mkdir(root+'/apps/web/.next',{recursive:true});
await cp('apps/web/.next/static',root+'/apps/web/.next/static',{recursive:true});
if(await stat('apps/web/public').catch(()=>null))await cp('apps/web/public',root+'/apps/web/public',{recursive:true});
// Pinned Next emits CommonJS server.js; this repository's root is ESM.
// Keep generated contents intact and give the entry its correct module suffix.
await rename(root+'/apps/web/server.js',root+'/apps/web/server.cjs');
await cp('scripts/start-web.mjs',root+'/start-web.mjs');
await writeFile(root+'/.desvio-build.json',JSON.stringify({api_origin:api})+'\n');
console.log('Standalone web artifact prepared; no provider or database credentials required');
