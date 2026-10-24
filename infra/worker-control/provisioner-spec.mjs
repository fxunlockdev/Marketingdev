import {createHash} from 'node:crypto';
import {provisionerConfigFromEnv} from '../../dist/config.js';
const keys=['APP_MODE','POSTIZ_PROVISIONER_DATABASE_URL','TEMPORAL_ADDRESS','TEMPORAL_NAMESPACE','POSTIZ_PROVISION_TASK_QUEUE','POSTIZ_BASE_URL','POSTIZ_MEDIA_ORIGINS','POSTIZ_CALLBACK_ORIGIN','POSTIZ_ENCRYPTION_KEY','POSTIZ_ENTERPRISE_SIGNING_SECRET'];
export function provisionerHostSpec(input){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>![...keys,'DESVIO_WORKER_IMAGE'].includes(k)))throw Error('PROVISIONER_EXCESS_CONFIGURATION');
 if(!/^sha256:[a-f0-9]{64}$/.test(input.DESVIO_WORKER_IMAGE??''))throw Error('PROVISIONER_IMAGE_PIN_REQUIRED');
 const values=Object.fromEntries(keys.filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
 try{
  provisionerConfigFromEnv(values);
  const db=new URL(values.POSTIZ_PROVISIONER_DATABASE_URL);
  if(db.username!=='desvio_provisioner'||!['postgres:','postgresql:'].includes(db.protocol)||values.POSTIZ_PROVISION_TASK_QUEUE==='desvio-assets')throw Error();
 }catch{throw Error('PROVISIONER_CONFIGURATION_INVALID');}
 const image=input.DESVIO_WORKER_IMAGE,configurationHash=createHash('sha256').update(JSON.stringify({image,values})).digest('hex');
 return {image,values,configurationHash};
}
// Receives only the narrow, validated spec over stdin; never mounts the Docker socket.
export const provisionerStartProbe=`import sys,json,subprocess,os
s=json.load(sys.stdin); name='desvio-postiz-provisioner'
def docker(args):
 return subprocess.check_output(['docker']+args,text=True,stderr=subprocess.PIPE,env=dict(os.environ,**s['values'])).strip()
def inspect():
 ids=docker(['ps','-aq','--filter','name=^/'+name+'$'])
 return json.loads(docker(['inspect',ids]))[0] if ids else None
def verify(c):
 if c['Image']!=s['image'] or c['Config']['Labels'].get('desvio.configuration')!=s['configurationHash'] or c['Config']['Labels'].get('desvio.purpose')!='postiz-provisioner': raise Exception('configuration')
 if any(m['Type']!='tmpfs' or m['Destination']!='/tmp' for m in c['Mounts']) or not c['HostConfig']['ReadonlyRootfs'] or c['HostConfig']['Privileged']: raise Exception('isolation')
try:
 image=json.loads(docker(['image','inspect',s['image']]))[0]
 if image['Architecture']!='amd64' or image['Os']!='linux' or image['Config']['User']!='node': raise Exception('image')
 prior=inspect()
 if prior: verify(prior)
 else:
  args=['create','--name',name,'--label','desvio.purpose=postiz-provisioner','--label','desvio.configuration='+s['configurationHash'],'--restart','unless-stopped','--network','host','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--memory-swap','768m','--cpus','1','--stop-timeout','120','--tmpfs','/tmp:rw,noexec,nosuid,size=64m']
  for key in s['values']: args+=['-e',key]
  args += [s['image'],'node','dist/provisioner-main.js']
  docker(args)
 current=inspect();verify(current)
 if not current['State']['Running']: docker(['start',name])
 current=inspect();verify(current)
 print(json.dumps({'container_id':current['Id'],'running':current['State']['Running'],'image_id':current['Image'],'configuration_hash':s['configurationHash'],'socket_mounted':False}))
except Exception:
 print('PROVISIONER_START_FAILED_RECONCILE',file=sys.stderr);sys.exit(1)
`;
