import {GENERATION_LIMITS} from './creative-budget.js';
import type {Queryable} from './learning-observations.js';

/** Creative image storage a business has used in the rolling window. Images whose every
 * version sits in an archived project do not count, so archiving frees room. One query for
 * every generation path (Canvas, carousels, the worker) so the limits always agree. */
export const creativeMediaUsageSQL=`SELECT COALESCE(sum(m.bytes),0) AS n FROM app.creative_media m
 WHERE m.organization_id=$1 AND m.brand_id=$2 AND m.created_at>now()-interval '${GENERATION_LIMITS.windowDays} days'
 AND NOT EXISTS(SELECT 1 FROM app.creative_versions v JOIN app.creative_projects p ON p.id=v.project_id WHERE v.media_id=m.id AND p.archived_at IS NOT NULL)`;

export async function creativeMediaUsed(db:Queryable,organizationId:string,brandId:string):Promise<number>{
 return Number((await db.query(creativeMediaUsageSQL,[organizationId,brandId])).rows[0]?.n??0);
}

/** Whether `images` more creatives fit, reserving the usual allowance per image. */
export function creativeStorageFits(used:number,images=1):boolean{
 return Number.isFinite(used)&&used+images*GENERATION_LIMITS.reserveBytes<=GENERATION_LIMITS.storageBytes;
}
