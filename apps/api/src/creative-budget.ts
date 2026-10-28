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
