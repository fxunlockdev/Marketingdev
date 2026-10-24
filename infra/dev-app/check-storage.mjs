import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ObjectStore} from '../../dist/object-store.js';
let store,key;
try{
 const c=JSON.parse(execFileSync('railway',['bucket','credentials','--bucket','9355c904-bbb8-434b-b1b9-7f7a11ff7f32','--environment','6a760b10-9ed8-4f01-9c4a-77a25919755a','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 store=new ObjectStore({endpoint:c.endpoint,region:c.region,bucket:c.bucketName,accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey});key='deployment-cors-probe/'+randomUUID();
 const bytes=Buffer.from('Desvio private storage transport acceptance'),url=await store.uploadURL(key,bytes.length,'text/plain'),origin='https://desvio-dev-web-dev.up.railway.app';
 const options=o=>fetch(url,{method:'OPTIONS',headers:{Origin:o,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'},signal:AbortSignal.timeout(15000)});
 const allowed=await options(origin),denied=await options('https://untrusted.example');console.log(JSON.stringify({phase:'preflight',allowed_status:allowed.status,allowed_origin:allowed.headers.get('access-control-allow-origin'),denied_status:denied.status,denied_origin:denied.headers.get('access-control-allow-origin')}));
 if(!allowed.ok)throw Error();
 const upload=await fetch(url,{method:'PUT',headers:{Origin:origin,'Content-Type':'text/plain','Content-Length':String(bytes.length)},body:bytes,signal:AbortSignal.timeout(15000)});console.log(JSON.stringify({phase:'upload',status:upload.status,origin:upload.headers.get('access-control-allow-origin')}));if(!upload.ok)throw Error();
 if(!(await store.read(key)).equals(bytes))throw Error();
 const anonymous=await fetch(url.split('?')[0],{signal:AbortSignal.timeout(15000)});if(anonymous.ok)throw Error();
 await store.removeQuarantine(key);key=null;
 const report={checked_at:new Date().toISOString(),allowed_origin:origin,status:'PARTIAL',preflight_allowed:true,preflight_allowed_origin:allowed.headers.get('access-control-allow-origin'),foreign_preflight_origin:denied.headers.get('access-control-allow-origin'),upload_allowed_origin:upload.headers.get('access-control-allow-origin'),foreign_origin_denied:false,signed_put:true,readback:true,anonymous_denied:true,probe_removed:true,scope:'Real S3 HTTP/CORS acceptance using production ObjectStore; browser and authenticated application flow still required'};writeFileSync('docs/evidence/railway-dev-cors-acceptance.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('BROWSER_STORAGE_ACCEPTANCE_FAILED');process.exitCode=1;}finally{if(key)await store?.removeQuarantine(key).catch(()=>console.error('STORAGE_PROBE_CLEANUP_REQUIRED'));store?.close();}
