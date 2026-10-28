import {parseCampaignRefinement,type CampaignRefinement} from './campaign-refinement.js';
import {CAMPAIGN_STYLES,CAMPAIGN_FONTS,CAMPAIGN_CREATIVITY,type CampaignDesign} from './campaign-design.js';
import {BadRequestException} from '@nestjs/common';
import {object} from './workspaces.js';
export type CampaignInput={design?:CampaignDesign;refinement?:CampaignRefinement;name:string;theme:string;cta:string;target_url:string;channels:('instagram'|'linkedin'|'facebook')[]};
export function campaignInput(input:unknown):CampaignInput|undefined{
 if(input===undefined)return undefined;
 const v=object(input,['name','theme','cta','target_url','channels','design','refinement']);
 for(const [key,max,required] of [['name',140,true],['theme',1200,true],['cta',120,false],['target_url',2048,false]] as const){
  if(typeof v[key]!=='string'||(required&&!v[key].trim())||v[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v[key]))throw new BadRequestException('Check your campaign name, theme, call to action and link');
 }
 if(v.design!==undefined){const d=object(v.design,['style','font','creativity']);if((d.creativity!==undefined&&!CAMPAIGN_CREATIVITY.some(c=>c.id===d.creativity))||!CAMPAIGN_STYLES.some(s=>s.id===d.style)||!CAMPAIGN_FONTS.some(f=>f.id===d.font))throw new BadRequestException('Choose a visual style and font');}
 let refinement:CampaignRefinement|undefined;try{refinement=parseCampaignRefinement(v.refinement);}catch(e){throw new BadRequestException((e as Error).message);}
 let url=String(v.target_url).trim();
 if(url){try{if(!/^https?:\/\//i.test(url))url='https://'+url;const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||!parsed.hostname.includes('.'))throw new Error();url=parsed.href;}catch{throw new BadRequestException('Enter a valid website link');}}
 if(!Array.isArray(v.channels)||!v.channels.length||v.channels.length>3||v.channels.some(c=>!['instagram','linkedin','facebook'].includes(c))||new Set(v.channels).size!==v.channels.length)throw new BadRequestException('Choose your campaign channels');
 return {...(refinement?{refinement}:{}),...(v.design?{design:v.design as CampaignDesign}:{}),name:String(v.name).trim(),theme:String(v.theme).trim(),cta:String(v.cta).trim(),target_url:url,channels:v.channels as CampaignInput['channels']};
}
