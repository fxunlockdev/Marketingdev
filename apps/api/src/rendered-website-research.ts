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
 async capture(jobs:AssetJobs,scope:JobScope,url:string){
  let primary:Awaited<ReturnType<OpenAIWebsiteResearch['capture']>>|undefined;
  try{primary=await this.primary.capture(jobs,scope,url);}
  catch(error){if(!(error instanceof IntakeError)||error.code!=='AI_RESEARCH_NO_SOURCES'||!this.renderer.configured)throw error;}
  if(!this.renderer.configured||(primary&&Number(primary.coverage.photosAvailable)>0))return primary!;
  try{
   const rendered=await this.renderer.capture(jobs,scope,url);
   if(!primary)return rendered;
   // Prefer genuine page text over AI notes for matching URLs; preserve other
   // cited pages and add actual rendered image evidence to the same intake.
   const pages=[...rendered.pages,...primary.pages.filter(p=>!rendered.pages.some(r=>r.url===p.url))];
   const captures=new Map([...primary.captures,...rendered.captures]);
   return {...rendered,pages,captures,visualErrors:[...primary.visualErrors,...rendered.visualErrors],coverage:{...rendered.coverage,pages:pages.map(p=>p.url),researchAvailable:true}};
  }catch(error){
   if(error instanceof IntakeError&&error.code==='ACCESS_REVOKED_OR_CANCELED')throw error;
   if(!primary)throw error;
   return {...primary,visualErrors:[...primary.visualErrors,{url,code:error instanceof IntakeError?error.code:'WEBSITE_RENDER_FAILED'}]};
  }
 }
}
