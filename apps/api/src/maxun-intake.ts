import {MaxunWorkflow} from './maxun-workflow.js';
import {maxunJournal} from './maxun-journal.js';
import {maxunEvidence,MAXUN_CAPTURE_VERSION} from './maxun-evidence.js';
import {maxunScreenshot} from './maxun-screenshots.js';
import {AssetJobs,type JobScope} from './jobs.js';
import {IntakeError} from './safe-web.js';
import {digest} from './object-store.js';
import type {WebsitePage,VisualCapture} from './website-evidence.js';
export class MaxunIntake {
 constructor(readonly workflow:MaxunWorkflow,readonly screenshot= maxunScreenshot){}
 async capture(jobs:AssetJobs,scope:JobScope,url:string){
  const journal=maxunJournal(jobs,scope),result=await this.workflow.capture(scope,url,journal);
  const normalized=maxunEvidence(result.output,url),pages:WebsitePage[]=[],captures=new Map<string,{capture:VisualCapture;objects:{key:string;bytes:number;shot:VisualCapture['snapshots'][number]}[]}>(),visualErrors:{url:string;code:string}[]=[];
  if(!await journal.permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  // Preserve all returned formats privately, including full HTML/Markdown beyond
  // the bounded LLM context. Never render this untrusted HTML in the application.
  const raw=Buffer.from(JSON.stringify({version:MAXUN_CAPTURE_VERSION,output:result.output,partial:result.partial}));
  if(raw.length>16*1024*1024)throw new IntakeError('MAXUN_OUTPUT_TOO_LARGE');
  const rawHash=digest(raw),rawKey=`evidence/${scope.organizationId}/${scope.brandId}/${scope.jobId}/capture/${rawHash}`;
  await jobs.store.persist(rawKey,raw,'application/json',rawHash);
  for(const source of normalized.pages){
   const text=(source.text||source.markdown).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,40000);
   const capture:VisualCapture={version:MAXUN_CAPTURE_VERSION,url:source.url,coverage:'rendered_provider',requests:0,failures:[],snapshots:[]};
   for(const key of source.screenshotKeys){
    if(!await journal.permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
    try{
     const image=await this.screenshot(result.media,key,result.run.runId);
     capture.snapshots.push({viewport:{width:image.width,height:image.height},label:image.kind,height:image.height,truncated:false,sha256:image.sha256,screenshot:image.bytes.toString('base64'),observations:{title:source.title,text:'',links:source.links,images:[],typography:[],colors:[],captureKind:image.kind}});
    }catch(error){visualErrors.push({url:source.url,code:error instanceof IntakeError?error.code:'MAXUN_SCREENSHOT_UNAVAILABLE'});}
   }
   if(!source.screenshotKeys.length)visualErrors.push({url:source.url,code:'MAXUN_SCREENSHOT_MISSING'});
   if(capture.snapshots.length)captures.set(source.url,{capture,objects:[]});
   pages.push({url:source.url,parserVersion:MAXUN_CAPTURE_VERSION,sha256:digest(Buffer.from(JSON.stringify({content:source.sha256,images:capture.snapshots.map(s=>s.sha256)}))),chunks:Array.from({length:Math.ceil(text.length/8000)},(_,i)=>({text:text.slice(i*8000,(i+1)*8000),anchor:`maxun:${i*8000}`})),links:source.links,truncated:source.truncated,coverage:'rendered_provider'});
  }
  return {pages,captures,visualErrors,coverage:{pages:pages.map(p=>p.url),skipped:normalized.skipped,provider:'maxun',partial:result.partial,rawEvidence:{objectKey:rawKey,sha256:rawHash,bytes:raw.length}}};
 }
}
