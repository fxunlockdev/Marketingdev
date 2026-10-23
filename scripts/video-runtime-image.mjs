import {runtimeArchitecture,assertRuntimeArchitecture,pythonRuntimeImage} from './runtime-architecture.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,copyFileSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function prepareVideoImage(){
 const architecture=runtimeArchitecture(),tag=`desvio-video:${architecture}`;
 const root=resolve('.'),cache=process.env.DESVIO_VIDEO_DEB_CACHE??join(root,`work/video-deps-${architecture}/debs`);
 const pins=JSON.parse(readFileSync(`apps/video/debian-${architecture}-packages.json`,'utf8'));
 if(pins.some(p=>!existsSync(join(cache,p.filename)))){
  if(process.env.DESVIO_VIDEO_DEB_CACHE)throw new Error('The provided video archive cache is incomplete');
  execFileSync('python3',['scripts/fetch-document-deps.py','video',architecture],{stdio:'inherit',timeout:320000});
 }
 const context=mkdtempSync(join(root,'work/video-runtime-build-'));
 try{
  execFileSync('python3',['scripts/prepare-video-bundle.py',cache,join(context,'bundle'),architecture],{stdio:'inherit',timeout:120000});
  for(const name of ['Dockerfile','runtime.py',`debian-${architecture}-packages.json`])copyFileSync(join(root,'apps/video',name),join(context,name));
  execFileSync('docker',['build','--build-arg',`BASE_IMAGE=${pythonRuntimeImage(architecture)}`,'--platform',`linux/${architecture}`,'--build-arg',`RUNTIME_ARCH=${architecture}`,'--network','none','-t',tag,context],{stdio:'inherit',timeout:300000});
  const image=execFileSync('docker',['image','inspect',tag,'--format','{{.Id}}'],{encoding:'utf8',timeout:10000}).trim();
  if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Exact video runtime image missing');
  assertRuntimeArchitecture(image,architecture);
  return image;
 }finally{rmSync(context,{recursive:true,force:true});}
}
if(process.argv[1]===resolve('scripts/video-runtime-image.mjs'))console.log(prepareVideoImage());
