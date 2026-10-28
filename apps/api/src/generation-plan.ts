import {normalizeCreativeSpec,type CreativeSpec} from './campaign-formats.js';
/** Suggested monthly mix, separate from the shared provider-cost spending cap. */
export function generationPlanMix(monthlyPrice:number){
 switch(monthlyPrice){
  case 500:return {image_posts:15,video_posts:2,daily_images:false};
  case 800:return {image_posts:30,video_posts:5,daily_images:true};
  case 1000:return {image_posts:45,video_posts:8,daily_images:false};
  default:throw new Error('GENERATION_PLAN_INVALID');
 }
}
/** Rolling calendar month, clamping the anniversary for short months. */
export function campaignMonthDays(start:string):number{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start))throw new Error('CAMPAIGN_DATE_INVALID');
 const date=new Date(`${start}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==start)throw new Error('CAMPAIGN_DATE_INVALID');
 const year=date.getUTCFullYear(),month=date.getUTCMonth(),day=date.getUTCDate();
 const last=new Date(Date.UTC(year,month+2,0)).getUTCDate();
 const next=new Date(Date.UTC(year,month+1,Math.min(day,last)));
 return Math.round((next.getTime()-date.getTime())/86400000);
}

export type ContentMixItem={channel:'instagram'|'facebook'|'linkedin';format:'static'|'carousel'|'video';creative_spec:CreativeSpec;count:number};
export function normalizeContentMix(value:unknown):ContentMixItem[]{
 if(!Array.isArray(value)||value.length<1||value.length>30)throw new Error('Choose at least one content type');
 const seen=new Set<string>();let total=0,videos=0;
 const result=value.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='channel,count,creative_spec,format'||!['instagram','facebook','linkedin'].includes(raw.channel)||!['static','carousel','video'].includes(raw.format)||!Number.isSafeInteger(raw.count)||raw.count<1||raw.count>90)throw new Error('Check the campaign content quantities');
  const creative_spec=normalizeCreativeSpec(raw.creative_spec,raw.format,raw.channel);
  const key=JSON.stringify([raw.channel,raw.format,creative_spec]);if(seen.has(key))throw new Error('Choose each content combination once');seen.add(key);total+=raw.count;if(raw.format==='video')videos+=raw.count;
  return {channel:raw.channel,format:raw.format,creative_spec,count:raw.count} as ContentMixItem;
 });
 if(total>90||videos>30)throw new Error('Choose up to 90 posts, including up to 30 videos');
 return result;
}
export function contentMixCounts(mix:ContentMixItem[]){return {post_count:mix.reduce((n,r)=>n+r.count,0),video_count:mix.filter(r=>r.format==='video').reduce((n,r)=>n+r.count,0)};}
