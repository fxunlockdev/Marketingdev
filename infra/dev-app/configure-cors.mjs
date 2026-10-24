import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {S3Client,PutBucketCorsCommand,GetBucketCorsCommand} from '@aws-sdk/client-s3';
let client;
try{
 const c=JSON.parse(execFileSync('railway',['bucket','credentials','--bucket','9355c904-bbb8-434b-b1b9-7f7a11ff7f32','--environment','6a760b10-9ed8-4f01-9c4a-77a25919755a','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 client=new S3Client({endpoint:c.endpoint,region:c.region,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:c.accessKeyId,secretAccessKey:c.secretAccessKey}});
 const rule={AllowedOrigins:['https://desvio-dev-web-dev.up.railway.app'],AllowedMethods:['GET','HEAD','PUT'],AllowedHeaders:['content-type','content-length'],ExposeHeaders:['ETag'],MaxAgeSeconds:300};
 await client.send(new PutBucketCorsCommand({Bucket:c.bucketName,CORSConfiguration:{CORSRules:[rule]}}));
 const observed=await client.send(new GetBucketCorsCommand({Bucket:c.bucketName}));
 const report={checked_at:new Date().toISOString(),bucket_id:'9355c904-bbb8-434b-b1b9-7f7a11ff7f32',rules:observed.CORSRules,scope:'Bucket CORS readback only; real browser upload still required'};writeFileSync('docs/evidence/railway-dev-cors.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(e){console.error(JSON.stringify({status:'CORS_CONFIGURATION_FAILED',code:e.name,http_status:e.$metadata?.httpStatusCode}));process.exitCode=1;}finally{client?.destroy();}
