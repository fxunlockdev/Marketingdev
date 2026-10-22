// Disposable local PostgreSQL only; no existing services, cloud or provider calls.
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {Pool} from 'pg';
const name=`desvio-deploy-${randomUUID()}`,password=randomBytes(32).toString('hex'),dir=await mkdtemp(resolve('work/deployment-data-'));
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
let started=false,pool;
try{
 docker('run','--rm','-d','--name',name,'--label','desvio.purpose=isolated-test','-v',`${dir}:/var/lib/postgresql/data`,'-p','127.0.0.1::5432','-e',`POSTGRES_PASSWORD=${password}`,'postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73');started=true;
 const port=docker('port',name,'5432/tcp').split(':').at(-1),url=`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
 pool=new Pool({connectionString:url,connectionTimeoutMillis:1000});pool.on('error',()=>{});let ready=false;
 for(let i=0;i<100;i++){try{await pool.query('SELECT 1');ready=true;break;}catch{await setTimeout(200);}}
 if(!ready)throw new Error('Disposable deployment database unavailable');
 process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--test','--test-concurrency=1','tests/deployment/bootstrap.test.mjs'],{stdio:'inherit',env:{...process.env,DESVIO_TEST_ADMIN_URL:url}});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{await pool?.end();if(started){try{docker('rm','-f',name);}catch{}}await rm(dir,{recursive:true,force:true});}
