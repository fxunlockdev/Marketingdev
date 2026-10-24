// This report proves configuration and local images only, never provider connectivity.
export function workerReadiness(spec,observed){
 if(!Array.isArray(observed.images)||spec.images.some(id=>!observed.images.some(i=>i.id===id&&i.os==='linux'&&i.architecture==='amd64')))throw Error('WORKER_IMAGE_INVENTORY_MISMATCH');
 const prior=observed.worker;
 if(prior&&prior.purpose!=='trusted-worker')throw Error('WORKER_CONTAINER_IDENTITY_MISMATCH');
 const matches=prior?.image===spec.image&&prior?.configuration===spec.configurationHash;
 return {status:!prior?'worker_absent':matches?'configuration_matches':'replacement_required',
  running:prior?.running===true,desired_image:spec.image,
  video_enabled:spec.values.VIDEO_ENABLED==='true',publishing_enabled:spec.values.POSTIZ_PUBLISHING_ENABLED==='true',
  credentials_present:Object.fromEntries(['OPENAI_API_KEY','GEMINI_API_KEY','HIGGSFIELD_CREDENTIALS'].map(k=>[k,Boolean(spec.values[k])])),
  changed_services:false,paid_calls:false,
  scope:'Exact local image inventory and desired worker configuration only. Provider access, business allowances, API flags and live acceptance are separate.'};
}

export const readinessProbe=`import json,sys,subprocess
request=json.load(sys.stdin)
images=[]
for image in request['images']:
 info=json.loads(subprocess.check_output(['docker','image','inspect',image],stderr=subprocess.DEVNULL))[0]
 images.append({'id':info['Id'],'architecture':info['Architecture'],'os':info['Os']})
ids=subprocess.check_output(['docker','ps','-aq','--filter','name=^/desvio-trusted-worker$']).decode().strip()
worker=None
if ids:
 info=json.loads(subprocess.check_output(['docker','inspect','desvio-trusted-worker'],stderr=subprocess.DEVNULL))[0]
 labels=info['Config'].get('Labels') or {}
 worker={'id':info['Id'],'image':info['Image'],'configuration':labels.get('desvio.configuration'),'purpose':labels.get('desvio.purpose'),'running':info['State']['Running']}
print(json.dumps({'images':images,'worker':worker}))`;
