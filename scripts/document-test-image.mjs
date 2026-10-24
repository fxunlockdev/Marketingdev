import {runtimeArchitecture,assertRuntimeArchitecture,pythonRuntimeImage} from './runtime-architecture.mjs';
import {execFileSync} from 'node:child_process';
import {prepareDocumentNativeImage} from './document-native-image.mjs';
export function prepareDocumentImage(){
 const architecture=runtimeArchitecture(),tag=`desvio-ingestion:${architecture}`;
 execFileSync('uv',['run','--project','apps/ingestion','--frozen','--group','test','python','scripts/make_document_fixtures.py'],{stdio:['ignore','pipe','pipe'],timeout:180000});
 execFileSync('uv',['run','--project','apps/ingestion','--frozen','--group','test','python','scripts/make_document_visual_fixtures.py'],{stdio:['ignore','pipe','pipe'],timeout:180000});
 execFileSync('docker',['build','--build-arg',`BASE_IMAGE=${pythonRuntimeImage(architecture)}`,'--platform',`linux/${architecture}`,'-q','-t',tag,'apps/ingestion'],{stdio:['ignore','pipe','pipe'],timeout:1800000});
 const image=execFileSync('docker',['image','inspect',tag,'--format','{{.Id}}'],{encoding:'utf8',timeout:10000}).trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Parser image build did not return an exact digest');
 assertRuntimeArchitecture(image,architecture);
 const native=prepareDocumentNativeImage();
 console.log(`Isolated Docling/OCR test image ${native}; no network, no credentials, non-root, bounded CPU/memory`);return native;
}
