import {GENERATION_LIMITS} from './creative-budget.js';
import type {Queryable} from './learning-observations.js';

/** Creative image storage a business has used in the rolling window. Images whose every
 * version sits in an archived project do not count, so archiving frees room. One database
 * function (migration 142) for every generation path (Canvas, carousels, the worker), so the
 * limits always agree and the count stays fast under row-level security. */
export const creativeMediaUsageSQL='SELECT app.creative_media_used($1,$2,$3) AS n';

export async function creativeMediaUsed(db:Queryable,organizationId:string,brandId:string):Promise<number>{
 return Number((await db.query(creativeMediaUsageSQL,[organizationId,brandId,GENERATION_LIMITS.windowDays])).rows[0]?.n??0);
}

/** Whether `images` more creatives fit, reserving the usual allowance per image. */
export function creativeStorageFits(used:number,images=1):boolean{
 return Number.isFinite(used)&&used+images*GENERATION_LIMITS.reserveBytes<=GENERATION_LIMITS.storageBytes;
}
