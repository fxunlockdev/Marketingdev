import {BadRequestException} from '@nestjs/common';
import type {PoolClient} from 'pg';
export type CreativeTextProvider='openai'|'gemini';
export function creativeTextProvider(value:unknown):CreativeTextProvider{
 if(value===undefined)return 'openai';
 if(value!=='openai')throw new BadRequestException('Creative planning uses OpenAI GPT only');
 return value;
}
export async function creativeTextModel(db:PoolClient,org:string,brand:string,provider:CreativeTextProvider):Promise<string|null>{
 const query=provider==='gemini'?'SELECT text_model FROM app.gemini_creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()':'SELECT text_model FROM app.creative_grants WHERE organization_id=$1 AND brand_id=$2 AND enabled AND expires_at>now()';
 return (await db.query(query,[org,brand])).rows[0]?.text_model??null;
}
