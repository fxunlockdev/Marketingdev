/** Owner-facing monthly "what worked, what didn't" review, read inside the caller's business transaction. */
import {BadRequestException} from '@nestjs/common';
import {Businesses} from './businesses.js';
import {monthlyReview,ReviewError,type MonthlyReview} from './learning-review.js';

export function reviewMonth(value:unknown,now:Date=new Date()):string{
 if(value===undefined)return now.toISOString().slice(0,7);
 if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw new BadRequestException('Choose a month as YYYY-MM');
 return value;
}

export class LearningReviews{
 constructor(readonly businesses:Businesses){}
 async review(user:string,id:string,month:unknown):Promise<MonthlyReview>{
  const chosen=reviewMonth(month),b=await this.businesses.resolve(user,id);
  try{return await this.businesses.database.transaction(user,b.organization_id,false,db=>monthlyReview(db,{},chosen),id);}
  catch(error){if(error instanceof ReviewError)throw new BadRequestException('Choose a month as YYYY-MM');throw error;}
 }
}
