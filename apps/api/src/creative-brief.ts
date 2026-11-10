import {BadRequestException} from '@nestjs/common';
export type CreativeBrief = {markets?:string;languages?:string;timing?:string;direction?:string};
export function validateCreativeBrief(value:unknown):CreativeBrief {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!['markets','languages','timing','direction'].includes(key))) throw new BadRequestException('Check your creative brief.');
 const result:CreativeBrief={};
 for(const [key,item] of Object.entries(value)) {
  if(typeof item!=='string'||item.length>600||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(item)) throw new BadRequestException('Keep each creative brief answer within 600 characters.');
  result[key as keyof CreativeBrief]=item.trim();
 }
 return result;
}
