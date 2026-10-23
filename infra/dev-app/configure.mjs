import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const project='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment='6a760b10-9ed8-4f01-9c4a-77a25919755a',api='21260f12-2ad2-413c-9f67-2a1c4d6f8c83',web='a92160c2-54ef-4523-b13b-4a9a0e2dbdd2',origin='https://desvio-dev-web-dev.up.railway.app';
const run=(args,input)=>execFileSync('railway',args,{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']});
try{
 const file='work/railway-dev-runtime-secrets.json',secrets=JSON.parse(readFileSync(file));if(secrets.environment_id!==environment)throw Error();
 secrets.application??={AUTH_SECRET:randomBytes(32).toString('hex'),MAIL_ENCRYPTION_KEY:randomBytes(32).toString('hex')};writeFileSync(file,JSON.stringify(secrets,null,2)+'\n',{mode:0o600});
 const variables=id=>JSON.parse(run(['variables','--project',project,'--environment',environment,'--service',id,'--json']));
 const db=variables('758bf0c1-56b5-452f-be8d-fe67af927267'),v=variables(api);

 const s3=JSON.parse(run(['bucket','credentials','--bucket','9355c904-bbb8-434b-b1b9-7f7a11ff7f32','--environment',environment,'--json']));
 const url=(role,key)=>{const u=new URL(db.DATABASE_URL);u.username=role;u.password=secrets.passwords[key];return u.toString();};
 const app={APP_MODE:'staging',APP_ORIGIN:origin,PORT:'3100',LISTEN_HOST:'::',RAILWAY_DOCKERFILE_PATH:'infra/api.Dockerfile',...secrets.application,AUTH_DATABASE_URL:url('desvio_auth','AUTH_DATABASE_PASSWORD'),APP_DATABASE_URL:url('desvio_app','APP_DATABASE_PASSWORD'),MAIL_DATABASE_URL:url('desvio_mail','MAIL_DATABASE_PASSWORD'),S3_ENDPOINT:s3.endpoint,S3_REGION:s3.region,S3_BUCKET:s3.bucketName,S3_ACCESS_KEY_ID:s3.accessKeyId,S3_SECRET_ACCESS_KEY:s3.secretAccessKey,VIDEO_ENABLED:'false',POSTIZ_ENABLED:'false',POSTIZ_PUBLISHING_ENABLED:'false',POSTIZ_PROVISIONING_ENABLED:'false'};
 const frontend={APP_MODE:'staging',APP_ORIGIN:origin,PORT:'3000',LISTEN_HOST:'::',API_ORIGIN:'http://${{desvio-dev-api.RAILWAY_PRIVATE_DOMAIN}}:3100',S3_BROWSER_ORIGIN:new URL(s3.endpoint).origin,RAILWAY_DOCKERFILE_PATH:'infra/web.Dockerfile'};
 for(const [id,values] of [[api,app],[web,frontend]])for(const [key,value] of Object.entries(values))run(['variable','set',key,'--stdin','--skip-deploys','--project',project,'--environment',environment,'--service',id,'--json'],value);
 for(const [id,values] of [[api,app],[web,frontend]]){const observed=variables(id);for(const [key,value] of Object.entries(values))if(key!=='API_ORIGIN'&&observed[key]!==value)throw Error();}
 const observed=variables(api),missing=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'].filter(k=>!observed[k]);
 const report={checked_at:new Date().toISOString(),environment_id:environment,api_service_id:api,web_service_id:web,origin,configuration_readback:true,missing,scope:'Prepared application services only; no API/web deployment or email delivery acceptance'};writeFileSync('docs/evidence/railway-dev-app-configuration.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('APP_CONFIGURATION_FAILED_RECONCILE');process.exitCode=1;}
