import {BadRequestException} from '@nestjs/common';
import type {PoolClient} from 'pg';
// GPT-6 directs image and carousel creation; the image renderer remains separately configured.
export const IMAGE_PLANNING_MODEL='gpt-6-sol';
export function imagePlanningRates(maxInputTokens:number){return {input_micros_per_token:maxInputTokens>272000?5:2.5,output_micros_per_token:maxInputTokens>272000?15:10};}
export type CreativeTextProvider='openai'|'gemini';
export function creativeTextProvider(value:unknown):CreativeTextProvider{
 if(value===undefined)return 'openai';
 if(value!=='openai')throw new BadRequestException('Creative planning uses OpenAI GPT only');
 return value;
}
export async function creativeTextModel(db:PoolClient,org:string,brand:string,provider:CreativeTextProvider,purpose:'image'|'legacy'='legacy'):Promise<string|null>{
 const query=provider==='gemini'?'SELECT text_model FROM app.gemini_creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()':'SELECT text_model FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()';
 const grant=(await db.query(query,[org,brand])).rows[0];
 return grant?(purpose==='image'&&provider==='openai'?IMAGE_PLANNING_MODEL:grant.text_model):null;
}
