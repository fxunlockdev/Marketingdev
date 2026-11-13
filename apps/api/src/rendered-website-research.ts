import {IntakeError} from './safe-web.js';
import type {OpenAIWebsiteResearch,MarketResearch} from './openai-website-research.js';
import type {GuidedBrief} from './guided-campaign-contracts.js';
import type {WebsiteRenderer} from './website-renderer.js';
import type {AssetJobs,JobScope} from './jobs.js';
/** Local browser fallback has no external paid capture side effect. Primary GPT
 * research remains governed by its existing durable allowance and call ledger. */
export class RenderedWebsiteResearch{
 constructor(readonly primary:Pick<OpenAIWebsiteResearch,'capture'>&Partial<Pick<OpenAIWebsiteResearch,'market'>>,readonly renderer:Pick<WebsiteRenderer,'configured'|'capture'>){}
 /** Market research is the primary provider's separate step; the local browser adds nothing to it. */
 async market(jobs:AssetJobs,scope:JobScope,url:string,brief?:GuidedBrief|null,competitors?:readonly string[]):Promise<MarketResearch>{
  if(!this.primary.market)return {pages:[],summary:{status:'skipped',code:'AI_NOT_CONFIGURED',notes:0,sources:0,discovered_competitors:[],audience_suggestions:[],competitors_covered:[]}};
  return this.primary.market(jobs,scope,url,brief,competitors);
 }
 /** GPT site research and the rendered crawler read the site side by side; the capture succeeds
  * when either produced pages. Genuine page text is preferred over AI notes for the same URL. */
 async capture(jobs:AssetJobs,scope:JobScope,url:string,options:{signal?:AbortSignal}={}){
  const [first,second]=await Promise.allSettled([this.primary.capture(jobs,scope,url,options),this.renderer.configured?this.renderer.capture(jobs,scope,url):Promise.reject(new IntakeError('WEBSITE_RENDER_NOT_CONFIGURED'))]);
  const revoked=(r:PromiseSettledResult<unknown>)=>r.status==='rejected'&&r.reason instanceof IntakeError&&r.reason.code==='ACCESS_REVOKED_OR_CANCELED';
  if(revoked(first)||revoked(second))throw new IntakeError('ACCESS_REVOKED_OR_CANCELED');
  if(first.status==='rejected'){
   if(second.status==='fulfilled'&&first.reason instanceof IntakeError)return second.value;
   throw first.reason;
  }
  const primary=first.value;
  if(second.status==='rejected'){
   if(!this.renderer.configured||Number(primary.coverage.photosAvailable)>0)return primary;
   return {...primary,visualErrors:[...primary.visualErrors,{url,code:second.reason instanceof IntakeError?second.reason.code:'WEBSITE_RENDER_FAILED'}]};
  }
  const rendered=second.value;
  const pages=[...rendered.pages,...primary.pages.filter(p=>!rendered.pages.some(r=>r.url===p.url))];
  const captures=new Map([...primary.captures,...rendered.captures]);
  return {...rendered,pages,captures,visualErrors:[...primary.visualErrors,...rendered.visualErrors],coverage:{...rendered.coverage,pages:pages.map(p=>p.url),researchAvailable:true}};
 }
}
