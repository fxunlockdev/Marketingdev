import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {assertRuntimeArchitecture} from './runtime-architecture.mjs';
export function prepareWorkerImage(){
 execFileSync('docker',['build','--platform','linux/amd64','-f','infra/api.Dockerfile','-t','desvio-api:dev-amd64','.'],{stdio:'inherit',timeout:1800000});
 const api=execFileSync('docker',['image','inspect','desvio-api:dev-amd64','--format','{{.Id}}'],{encoding:'utf8',timeout:10000}).trim();
 assertRuntimeArchitecture(api,'amd64');
 execFileSync('docker',['build','--platform','linux/amd64','--build-arg',`API_IMAGE=${api}`,'-f','infra/worker.Dockerfile','-t','desvio-worker:dev-amd64','.'],{stdio:'inherit',timeout:300000});
 const image=execFileSync('docker',['image','inspect','desvio-worker:dev-amd64','--format','{{.Id}}'],{encoding:'utf8',timeout:10000}).trim();
 assertRuntimeArchitecture(image,'amd64');return image;
}
if(process.argv[1]===resolve('scripts/worker-image.mjs'))console.log(prepareWorkerImage());
