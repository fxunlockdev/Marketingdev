import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
export function runtimeArchitecture(){
 const value=process.env.DESVIO_RUNTIME_ARCH??execFileSync('docker',['info','--format','{{.Architecture}}'],{encoding:'utf8',timeout:10000}).trim();
 const architecture={arm64:'arm64',aarch64:'arm64',amd64:'amd64',x86_64:'amd64'}[value];
 if(!architecture)throw new Error('Unsupported isolated runtime architecture');
 return architecture;
}
export function assertRuntimeArchitecture(image,expected){
 const actual=execFileSync('docker',['image','inspect',image,'--format','{{.Architecture}}'],{encoding:'utf8',timeout:10000}).trim();
 if(actual!==expected)throw new Error('Isolated runtime image architecture mismatch');
}

export function pythonRuntimeImage(architecture){
 const image=JSON.parse(readFileSync(new URL('../infra/python-runtime-image.json',import.meta.url))).images[architecture];
 if(!/^python:3\.12-slim@sha256:[a-f0-9]{64}$/.test(image??''))throw new Error('Missing pinned Python architecture');
 return image;
}

export function renderRuntimeImage(architecture){
 const image=JSON.parse(readFileSync(new URL('../infra/render-runtime-image.json',import.meta.url))).images[architecture];
 if(!/^node:22-slim@sha256:[a-f0-9]{64}$/.test(image??''))throw new Error('Missing pinned render architecture');
 return image;
}
