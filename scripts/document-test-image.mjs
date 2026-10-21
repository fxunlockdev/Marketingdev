import {execFileSync} from 'node:child_process';
export function prepareDocumentImage(){
 execFileSync('uv',['run','--project','apps/ingestion','--frozen','--group','test','python','scripts/make_document_fixtures.py'],{stdio:['ignore','pipe','pipe'],timeout:180000});
 execFileSync('docker',['build','-q','-t','desvio-ingestion:local','apps/ingestion'],{stdio:['ignore','pipe','pipe'],timeout:300000});
 const image=execFileSync('docker',['image','inspect','desvio-ingestion:local','--format','{{.Id}}'],{encoding:'utf8',timeout:10000}).trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Parser image build did not return an exact digest');
 console.log(`Isolated Docling test image ${image}; no network, no credentials, non-root, bounded CPU/memory`);return image;
}
