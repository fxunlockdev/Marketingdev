import {readFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
function origin(value,publicOrigin=false){
 try{const u=new URL(value);if(u.origin!==value||u.username||u.password||!['http:','https:'].includes(u.protocol)||publicOrigin&&u.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error();return u.origin;}catch{throw new Error('WEB_ORIGIN_INVALID');}
}
export function webRuntimeConfig(env,artifact){
 if(!['development','test','staging'].includes(env.APP_MODE))throw new Error('WEB_MODE_DENIED');
 const api=origin(env.API_ORIGIN),app=origin(env.APP_ORIGIN,true),storage=origin(env.S3_BROWSER_ORIGIN);
 if(env.APP_MODE==='staging'&&(!app.startsWith('https:')||!storage.startsWith('https:')))throw new Error('WEB_HTTPS_REQUIRED');
 if(artifact?.api_origin!==api)throw new Error('WEB_API_ORIGIN_REBUILD_REQUIRED');
 const port=env.PORT??'3000',host=env.LISTEN_HOST??'::';
 if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535||!isIP(host))throw new Error('WEB_LISTENER_INVALID');
 return {host,port};
}
export async function startWeb(root=dirname(fileURLToPath(import.meta.url)),env=process.env){
 const artifact=JSON.parse(await readFile(join(root,'.desvio-build.json'),'utf8'));
 const config=webRuntimeConfig(env,artifact);process.env.HOSTNAME=config.host;process.env.PORT=config.port;
 // The generated Next server owns its signal handling; no shell or extra worker.
 await import(pathToFileURL(join(root,'apps/web/server.cjs')).href);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await startWeb();}catch(error){process.stderr.write(error instanceof Error&&/^WEB_[A-Z_]+$/.test(error.message)?error.message+'\n':'WEB_START_FAILED\n');process.exitCode=1;}
}
