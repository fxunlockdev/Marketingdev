import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

// Same private Postiz component: backend, Temporal orchestrator and media gateway.
// No frontend process, provider model key, Docker socket or schema mutation here.
const children=[];let stopping=false;
if(process.env.STORAGE_PROVIDER!=='local'||process.env.UPLOAD_DIRECTORY!=='/uploads'||['OPENAI_API_KEY','GEMINI_API_KEY','HIGGSFIELD_CREDENTIALS'].some(key=>process.env[key]))throw Error('POSTIZ_RUNTIME_CONFIGURATION_INVALID');
const health=createServer(async(req,res)=>{
 if(req.method!=='GET'||req.url!=='/health'){res.writeHead(404);res.end();return;}
 let ok=false;
 try{
  const [backend,worker]=await Promise.all([fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(5000)}),fetch('http://127.0.0.1:3002/health/status',{signal:AbortSignal.timeout(5000)})]);
  ok=backend.ok&&worker.ok&&(await backend.text())==='App is running!'&&(await worker.json()).status==='ok'&&!stopping;
 }catch{}
 res.writeHead(ok?200:503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({status:ok?'ok':'unavailable'}));
});
function stop(code){
 if(stopping)return;stopping=true;process.exitCode=code;health.close();
 for(const child of children)child.kill('SIGTERM');
 const timer=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');process.exit(code);},20000);timer.unref();
 Promise.all(children.map(child=>child.pid===undefined||child.exitCode!==null||child.signalCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve)))).then(()=>process.exit(code));
}
function launch(command,args,cwd,env){
 const child=spawn(command,args,{cwd,env,stdio:'inherit'});children.push(child);
 child.once('error',()=>stop(1));child.once('exit',()=>{if(!stopping)stop(1);});
}
process.on('SIGTERM',()=>stop(0));process.on('SIGINT',()=>stop(0));health.on('error',()=>stop(1));
health.listen(5010,'127.0.0.1');
launch(process.execPath,['--experimental-require-module','dist/apps/backend/src/main.js'],'/app/apps/backend',{...process.env,PORT:'3000'});
launch(process.execPath,['--experimental-require-module','dist/apps/orchestrator/src/main.js'],'/app/apps/orchestrator',{...process.env,ORCHESTRATOR_PORT:'3002'});
launch('nginx',['-c','/opt/desvio-postiz/nginx.conf','-g','daemon off;'],'/tmp',{PATH:process.env.PATH});
