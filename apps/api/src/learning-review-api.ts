/** Owner-facing monthly "what worked, what didn't" review, read inside the caller's business transaction. */
import {BadRequestException,ConflictException,ForbiddenException,NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {Businesses} from './businesses.js';
import {monthlyReview,ReviewError,type MonthlyReview,type ProposedChange} from './learning-review.js';
import {performanceTrends,type Trends} from './insights-trends.js';
import type {Queryable} from './learning-observations.js';

export type AcceptedChange=ProposedChange&{id:string;month:string;accepted_at:string};
export type ReviewView=MonthlyReview&{can_accept:boolean;accepted:AcceptedChange[]};

export function reviewMonth(value:unknown,now:Date=new Date()):string{
 if(value===undefined)return now.toISOString().slice(0,7);
 if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new BadRequestException('Choose a month as YYYY-MM');
 return value;
}
const acceptedSQL='SELECT id,month,action,text,basis,sample_size,label,accepted_at FROM app.learning_accepted_changes WHERE month=$1 AND withdrawn_at IS NULL ORDER BY accepted_at,id';
/** Which proposals to accept: distinct indexes into the review's own proposed changes. */
export function chosenChanges(value:unknown,proposed:readonly ProposedChange[]):ProposedChange[]{
 if(!Array.isArray(value)||!value.length||value.length>5||value.some(i=>!Number.isInteger(i)||i<0||i>=proposed.length)||new Set(value).size!==value.length)throw new BadRequestException('Choose which recommendations to use next month');
 return value.map(i=>proposed[i as number]);
}
async function timezone(db:Queryable,brand:string):Promise<string|undefined>{const zone=(await db.query('SELECT timezone FROM app.business_onboarding WHERE brand_id=$1',[brand])).rows[0]?.timezone;return typeof zone==='string'?zone:undefined;}
async function manager(db:Queryable,organization:string,brand:string):Promise<boolean>{return (await db.query('SELECT app.social_manager($1,$2) allowed',[organization,brand])).rows[0]?.allowed===true;}

export class LearningReviews{
 constructor(readonly businesses:Businesses){}
 private async run<T>(user:string,id:string,write:boolean,fn:(db:Queryable,organization:string)=>Promise<T>):Promise<T>{
  const b=await this.businesses.resolve(user,id);
  try{return await this.businesses.database.transaction(user,b.organization_id,write,(db:Queryable)=>fn(db,b.organization_id),id);}
  catch(error){if(error instanceof ReviewError)throw new BadRequestException('Choose a month as YYYY-MM');throw error;}
 }
 async review(user:string,id:string,month:unknown):Promise<ReviewView>{
  const chosen=reviewMonth(month);
  return this.run(user,id,false,async(db,org)=>({...await monthlyReview(db,{timezone:await timezone(db,id)},chosen),can_accept:await manager(db,org,id),accepted:(await db.query(acceptedSQL,[chosen])).rows as AcceptedChange[]}));
 }
 /** "Use this for next month": record chosen proposals of the recomputed review. Accepting the same text twice is a no-op. */
 async accept(user:string,id:string,body:unknown):Promise<ReviewView>{
  const v=(body&&typeof body==='object'?body:{}) as {month?:unknown;changes?:unknown;confirmed?:unknown};
  const month=reviewMonth(v.month);if(v.confirmed!==true)throw new BadRequestException('Confirm the recommendations to use next month');
  await this.run(user,id,true,async(db,org)=>{
   if(!await manager(db,org,id))throw new ForbiddenException('Only a business owner or administrator can change next month’s plan');
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`learning-review:${id}`]);
   const review=await monthlyReview(db,{timezone:await timezone(db,id)},month);
   for(const c of chosenChanges(v.changes,review.proposed_changes))
    await db.query('INSERT INTO app.learning_accepted_changes(id,organization_id,brand_id,month,action,text,basis,sample_size,label,accepted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organization_id,brand_id,month,text) DO NOTHING',[randomUUID(),org,id,month,c.action,c.text.slice(0,400),c.basis.slice(0,400),c.sample_size,c.label.slice(0,60),user]);
  });
  return this.review(user,id,month);
 }
 async withdraw(user:string,id:string,change:string):Promise<{id:string;withdrawn:true}>{
  if(!/^[0-9a-f-]{36}$/i.test(change))throw new NotFoundException('Recommendation not found');
  return this.run(user,id,true,async(db,org)=>{
   if(!await manager(db,org,id))throw new ForbiddenException('Only a business owner or administrator can change next month’s plan');
   const r=await db.query('UPDATE app.learning_accepted_changes SET withdrawn_at=now(),withdrawn_by=$2 WHERE id=$1 AND withdrawn_at IS NULL RETURNING id',[change,user]);
   if(!r.rows.length)throw new ConflictException('This recommendation is not in use');
   return {id:change,withdrawn:true as const};
  });
 }
 async trends(user:string,id:string):Promise<Trends>{return this.run(user,id,false,db=>performanceTrends(db));}
}
