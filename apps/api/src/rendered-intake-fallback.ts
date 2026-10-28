import {createRequire} from 'node:module';
import {SafeWeb,IntakeError,websiteURL} from './safe-web.js';
import {maxunJournal} from './maxun-journal.js';
import type {AssetJobs,JobScope} from './jobs.js';
import type {MaxunIntake} from './maxun-intake.js';
import type {OpenAIWebsiteResearch} from './openai-website-research.js';
const robotsParser=createRequire(import.meta.url)('robots-parser');

/** Local policy preflight before a remote browser is allowed to receive a URL.
 * This cannot police the provider's browser subrequests; that remains a trusted
 * provider boundary. Never represent it as local browser network isolation. */
export async function renderedTarget(input:string,web:Pick<SafeWeb,'fetch'>=new SafeWeb()):Promise<string>{
 let target=websiteURL(input);const host=target.hostname.replace(/^www\./,'');
 const start=Date.now();
 for(let hop=0;hop<4;hop++){
  if(Date.now()-start>30000)throw new IntakeError('WEBSITE_TEXT_LIMIT');
  if(target.hostname.replace(/^www\./,'')!==host)throw new IntakeError('WEBSITE_TEXT_FOREIGN_REDIRECT');
  const robots=new URL('/robots.txt',target);
  const rules=await web.fetch(robots,256*1024,'text/plain',4000);
  if(![200,404,410].includes(rules.status))throw new IntakeError('WEBSITE_TEXT_ROBOTS_UNAVAILABLE');
  if(rules.status===200&&robotsParser(robots.href,rules.bytes.toString('utf8')).isAllowed(target.href,'DesvioBot')===false)throw new IntakeError('WEBSITE_TEXT_DISALLOWED');
  // SafeWeb resolves and pins public DNS; redirects are inspected individually.
  const page=await web.fetch(target,2*1024*1024,'text/html',4000);
  if([301,302,303,307,308].includes(page.status)&&typeof page.headers.location==='string'){
   target=websiteURL(new URL(page.headers.location,target).href);continue;
  }
  if(page.status!==200||!/^text\/html(?:;|$)/i.test(String(page.headers['content-type']??'')))throw new IntakeError('WEBSITE_TEXT_UNAVAILABLE');
  return target.href;
 }
 throw new IntakeError('WEBSITE_TEXT_REDIRECT_LIMIT');
}

/** Must atomically reserve a finite approved provider allowance for this exact
 * tenant/job before any paid crawl. Same-job replay must reuse the reservation.
 * A key alone is not authorization. Do not supply a no-op in production. */
export type AuthorizeRenderedCapture=(jobs:AssetJobs,scope:JobScope)=>Promise<void>;
export class RenderedIntakeFallback{
 readonly primary:Pick<OpenAIWebsiteResearch,'capture'>;
 readonly rendered:Pick<MaxunIntake,'capture'>;
 readonly authorize:AuthorizeRenderedCapture;
 readonly preflight:typeof renderedTarget;
 readonly journal:typeof maxunJournal;
 constructor(primary:Pick<OpenAIWebsiteResearch,'capture'>,rendered:Pick<MaxunIntake,'capture'>,authorize:AuthorizeRenderedCapture,preflight=renderedTarget,journal=maxunJournal){
  this.primary=primary;this.rendered=rendered;this.authorize=authorize;this.preflight=preflight;this.journal=journal;
 }
 async capture(jobs:AssetJobs,scope:JobScope,url:string){
  const journal=this.journal(jobs,scope);
  // Restart/recovery must resume the stored provider run, never call GPT again
  // or silently switch provider after an ambiguous paid browser submission.
  const saved=await journal.load();
  if(saved)return this.rendered.capture(jobs,scope,url);
  try{return await this.primary.capture(jobs,scope,url);}
  catch(error){
   // Only definite insufficient evidence may add the explicitly authorized
   // browser attempt. Quota/auth/timeout/unknown/cancel failures propagate.
   if(!(error instanceof IntakeError)||error.code!=='AI_RESEARCH_NO_SOURCES')throw error;
  }
  if(!await journal.permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  // Validate policy using the original URL; keep it as the journal identity.
  // The trusted browser handles the validated redirect and domain traversal.
  await this.preflight(url);
  await this.authorize(jobs,scope);
  if(!await journal.permitted())throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  const result=await this.rendered.capture(jobs,scope,url);
  if(!result.pages.some(page=>page.chunks.reduce((n,c)=>n+c.text.trim().length,0)>=160))throw new IntakeError('AI_RESEARCH_NO_SOURCES');
  return {...result,coverage:{...result.coverage,fallbackFrom:'openai_web_research',method:'rendered_provider'}};
 }
}
