// Shared with the provider broker: quotes cover every allowed planning step,
// not an invented estimate of actual provider usage.
export const CREATIVE_PLANNER_LIMITS={steps:3,bodyBytes:400000,inputAllowance:2048,outputTokens:4000} as const;
export function imageGenerationCapacity(grant:{max_image_request_micros:unknown;input_micros_per_token:unknown;output_micros_per_token:unknown},references:number){
 const image=Number(grant.max_image_request_micros),input=Number(grant.input_micros_per_token),output=Number(grant.output_micros_per_token);
 if(!Number.isSafeInteger(references)||references<0||references>3||![image,input,output].every(n=>Number.isFinite(n)&&n>0))throw new Error('Generation capacity configuration is invalid');
 const planning=CREATIVE_PLANNER_LIMITS.steps*Math.ceil((CREATIVE_PLANNER_LIMITS.bodyBytes+CREATIVE_PLANNER_LIMITS.inputAllowance)*input+CREATIVE_PLANNER_LIMITS.outputTokens*output);
 const micros=Math.ceil(image*(1+references)+planning),credits=Math.ceil(micros/10000);
 if(!Number.isSafeInteger(micros)||micros<1||credits>100000)throw new Error('Generation capacity exceeds the supported request limit');
 return {credits};
}

export function planningGenerationCapacity(grant:{input_micros_per_token:unknown;output_micros_per_token:unknown}){const input=Number(grant.input_micros_per_token),output=Number(grant.output_micros_per_token);if(![input,output].every(n=>Number.isFinite(n)&&n>0))throw new Error('Planning capacity configuration is invalid');return Math.ceil(CREATIVE_PLANNER_LIMITS.steps*Math.ceil((CREATIVE_PLANNER_LIMITS.bodyBytes+CREATIVE_PLANNER_LIMITS.inputAllowance)*input+16000*output)/10000);}

// One set of limits for every generation path. Storage and project caps are
// rolling windows so a business is never blocked for life by work it made months ago.
export const GENERATION_LIMITS={dailyImages:90,dailyExports:100,windowDays:30,storageBytes:536870912,reserveBytes:20971520,carouselProjects:100} as const;

export type BatchDemand={id:string;images:number;exports?:number};
export type BatchPlacement={id:string;day:number};
/** Reserve a whole batch up front against the daily caps. Work that does not fit
 * today is placed on the first following day with room, never rejected. */
export function scheduleBatch(items:readonly BatchDemand[],used:{images:number;exports?:number},caps:{images:number;exports:number}={images:GENERATION_LIMITS.dailyImages,exports:GENERATION_LIMITS.dailyExports}):BatchPlacement[]{
 const valid=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
 if(!valid(used.images)||!valid(used.exports??0)||!valid(caps.images)||!valid(caps.exports)||caps.images<1||caps.exports<1)throw new Error('Generation capacity configuration is invalid');
 const room=[{images:Math.max(0,caps.images-used.images),exports:Math.max(0,caps.exports-(used.exports??0))}];
 return items.map(item=>{
  const images=item.images,exports=item.exports??0;
  if(!valid(images)||!valid(exports)||images>caps.images||exports>caps.exports)throw new Error('A post needs more images than one day allows');
  for(let day=0;day<=items.length;day++){
   const slot=room[day]??(room[day]={images:caps.images,exports:caps.exports});
   if(slot.images>=images&&slot.exports>=exports){room[day]={images:slot.images-images,exports:slot.exports-exports};return {id:item.id,day};}
  }
  throw new Error('Generation could not be scheduled');
 });
}

export type AllowanceKind='static'|'carousel'|'video';
export type AllowanceItems=Record<AllowanceKind,{limit:number;used:number;remaining:number}>;
export type AllowanceShortfall={kind:AllowanceKind;requested:number;limit:number;used:number;remaining:number};
const ALLOWANCE_NAMES:Record<AllowanceKind,[string,string]>={static:['static post','static posts'],carousel:['carousel','carousels'],video:['video','videos']};
/** Compare a request with the monthly allowance before anything is queued. */
export function allowanceShortfalls(items:Partial<AllowanceItems>|null|undefined,requested:Partial<Record<AllowanceKind,number>>):AllowanceShortfall[]{
 if(!items)return [];
 return (['static','carousel','video'] as const).flatMap(kind=>{
  const row=items[kind],wanted=Number(requested[kind]??0);
  if(!row||!Number.isFinite(wanted)||wanted<=Number(row.remaining))return [];
  return [{kind,requested:wanted,limit:Number(row.limit),used:Number(row.used),remaining:Number(row.remaining)}];
 });
}
/** Exact counts, so the customer knows what to change before approving. */
export function allowanceMessage(shortfalls:readonly AllowanceShortfall[]):string|null{
 if(!shortfalls.length)return null;
 const parts=shortfalls.map(s=>`${s.requested} ${ALLOWANCE_NAMES[s.kind][s.requested===1?0:1]} requested, ${s.remaining} of ${s.limit} left (${s.used} used)`);
 return `This month’s allowance cannot cover this plan: ${parts.join('; ')}. Remove posts or wait for next month’s allowance.`;
}

export type SlotProgressState='scheduled'|'queued'|'generating'|'checking'|'ready'|'failed'|'waiting'|'parked'|'attention';
export type SlotProgress={state:SlotProgressState;label:string;reason:string|null;active:boolean;retryable:boolean};
const FAILURE_REASONS:Record<string,string>={
 CREATIVE_BUDGET_EXHAUSTED:'This business has used its generation budget.',
 CREATIVE_REQUEST_BUDGET_EXHAUSTED:'This post needed more credits than its approved cap.',
 CREATIVE_STORAGE_LIMIT:'Creative storage is full. Archive older creatives, then retry.',
 CREATIVE_PROVIDER_REJECTED:'The image provider declined this request.',
 CREATIVE_PROVIDER_NOT_CONFIGURED:'Image generation is not set up for this business.',
 CREATIVE_RETRIES_EXHAUSTED:'The image provider did not respond after several attempts.',
 CAROUSEL_RETRIES_EXHAUSTED:'The image provider did not respond after several attempts.',
 CAROUSEL_SLIDE_FAILED:'One slide could not be created, so the carousel stopped.',
 CAROUSEL_STOPPED:'The carousel stopped before this slide started.',
 CREATIVE_ACCESS_REVOKED:'The person who started this no longer has access.',
 CREATIVE_SLOT_CHANGED:'The post was edited while it was being created.',
 CREATIVE_REFERENCE_REVOKED:'A reference image is no longer approved.',
 CREATIVE_REFERENCE_INVALID:'A reference image could not be used.',
 CREATIVE_CONFIG_CHANGED:'Generation settings changed while this was waiting.',
 CREATIVE_RESULT_ABANDONED:'You stopped waiting for this request. The provider charge is uncertain.',
 CONTENT_ALLOWANCE_EXHAUSTED:'This month’s content allowance is used up.',
};
/** Customer-facing state derived only from the saved job; never an invented percentage. */
export function slotProgress(job:{status?:string|null;error_code?:string|null;scheduled_for?:string|null}|null|undefined):SlotProgress|null{
 const status=job?.status;
 if(!status)return null;
 const plain=(state:SlotProgressState,label:string,reason:string|null=null,active=false,retryable=false):SlotProgress=>({state,label,reason,active,retryable});
 if(status==='scheduled')return plain('scheduled','Scheduled',job?.scheduled_for?`Starts after ${job.scheduled_for} to stay within the daily image limit.`:'Starts on a following day to stay within the daily image limit.');
 if(status==='queued')return plain('queued','Queued',null,true);
 if(status==='running')return plain('generating','Generating',null,true);
 if(status==='retrying')return plain('checking','Checking','A temporary problem is being checked before continuing.',true);
 if(status==='succeeded')return plain('ready','Ready');
 if(status==='unknown')return plain('waiting','Waiting on provider','The provider has not confirmed this request. Nothing is sent again automatically.');
 if(status==='awaiting_approval')return plain('parked','Video on hold','Videos start after their script and starting image are approved.');
 if(status==='needs_attachment')return plain('attention','Ready to attach','Open this post to attach its saved visual.');
 if(status==='review_changed')return plain('attention','Post changed','This post was edited after approval. Review it before creating.');
 if(['failed','rejected','canceled'].includes(status))return plain('failed',status==='canceled'?'Stopped':'Failed',FAILURE_REASONS[String(job?.error_code??'')]??(status==='canceled'?'Generation was stopped before finishing.':'Generation stopped before finishing. Your topic is saved.'),false,true);
 return null;
}
const POLL_STEPS=[3000,5000,8000,13000,20000,30000] as const;
/** Back off while nothing changes; stop entirely when no job is active. */
export function nextPollDelay(active:boolean,unchangedPolls:number):number|null{
 if(!active)return null;
 return POLL_STEPS[Math.max(0,Math.min(POLL_STEPS.length-1,Math.floor(unchangedPolls)))];
}
