// Read-only image checks and harmless scanner acceptance on the exact private dev host.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
try {
 const state=JSON.parse(await readFile('work/railway-worker-host.json','utf8'));
 const inventory=JSON.parse(await readFile('docs/evidence/worker-image-inventory.json','utf8'));
 if(state.project_id!=='5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12'||state.environment_id!=='6a760b10-9ed8-4f01-9c4a-77a25919755a')throw Error();
 const code=`import json,subprocess,socket,struct,datetime
inventory=json.loads(${JSON.stringify(JSON.stringify(inventory.images))})
for image in inventory:
 info=json.loads(subprocess.check_output(['docker','image','inspect',image['image_id']]))[0]
 assert info['Id']==image['image_id'] and info['Architecture']=='amd64' and info['Os']=='linux' and info['Config']['User']==image['user']
def command(name,body=None):
 with socket.create_connection(('desvio-dev-scanner.railway.internal',3310),timeout=20) as s:
  s.sendall(('z'+name).encode()+bytes([0]))
  if body is not None: s.sendall(struct.pack('!I',len(body))+body+bytes(4))
  result=b''
  while bytes([0]) not in result:
   chunk=s.recv(4096)
   if not chunk: raise RuntimeError('protocol')
   result+=chunk
   if len(result)>4096: raise RuntimeError('protocol')
  return result.split(bytes([0]))[0].decode().strip()
version=command('VERSION')
date=datetime.datetime.strptime(version.split('/',2)[2],'%a %b %d %H:%M:%S %Y').replace(tzinfo=datetime.timezone.utc)
age=(datetime.datetime.now(datetime.timezone.utc)-date).total_seconds()
assert -3600<age<604800
assert command('INSTREAM',b'Desvio harmless scanner acceptance')=='stream: OK'
# Standard antivirus test string, not executable malware.
eicar=bytes.fromhex('58354f2150254041505b345c505a58353428505e2937434329377d2445494341522d5354414e444152442d414e544956495255532d544553542d46494c452124482b482a')
assert command('INSTREAM',eicar).endswith(' FOUND')
print(json.dumps({'images':inventory,'scanner_version':version,'clean_accepted':True,'antivirus_test_rejected':True,'signatures_fresh':True}))`;
 const out=execFileSync('railway',['sandbox','exec','--id',state.id,'--project',state.project_id,'--environment',state.environment_id,'--timeout','60','--','python3 -c '+quote(code)],{encoding:'utf8',timeout:70000,stdio:['ignore','pipe','pipe']});
 const report={checked_at:new Date().toISOString(),sandbox_id:state.id,...JSON.parse(out),scope:'Actual imported image identity/architecture/user and private scanner acceptance; worker jobs and providers not verified'};
 await writeFile('docs/evidence/railway-worker-host-checks.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch{console.error('HOST_ACCEPTANCE_FAILED');process.exitCode=1;}
