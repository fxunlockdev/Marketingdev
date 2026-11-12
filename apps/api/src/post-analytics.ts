/** Per-post results for the post drawer and the publishing activity. Lifetime totals as Post for Me reported them, with the
 * time of that reading. A post without a reading has no metrics (never zeros). Customer-scoped: call inside the business transaction. */
import {postformePublishedSQL,postformeFeedsSQL,postformeSnapshotsSQL,postformeObservations,OBSERVATION_LIMIT,type FeedRow,type PublishedRow,type Queryable,type SnapshotRow} from './learning-observations.js';

export type PostMetrics={publication_id:string;metrics:Record<string,number>;as_of:string;posted_at:string|null;hours_since_publish:number|null;semantics:'lifetime'};
export type SlotPublication={id:string;phase:string;observed_state:string;scheduled_at:string;account_name:string;provider:string;release_url:string|null;failure_reason:string|null;error_code:string|null;last_checked_at:string|null;created_at:string};
export type SlotPublishing={slot_id:string;publications:SlotPublication[];metrics:PostMetrics|null;timezone:string};

const publishedFor=(where:string):string=>postformePublishedSQL.replace("WHERE p.phase='accepted'",`WHERE ${where} AND p.phase='accepted'`).replace(` LIMIT ${OBSERVATION_LIMIT}`,' LIMIT 100');
export const slotPublishedSQL=publishedFor('p.slot_id=$1');
export const slotPublicationsSQL='SELECT p.id,p.phase,p.observed_state,p.scheduled_at,a.username account_name,a.platform provider,p.release_url,p.failure_reason,p.error_code,p.last_checked_at,p.created_at FROM app.postforme_publications p JOIN app.postforme_accounts a ON a.id=p.account_id WHERE p.slot_id=$1 ORDER BY p.created_at DESC,p.id LIMIT 20';

export async function measuredPosts(db:Queryable,published:PublishedRow[]):Promise<PostMetrics[]>{
 if(!published.length)return [];
 const feeds=(await db.query(postformeFeedsSQL)).rows as FeedRow[],snapshots=(await db.query(postformeSnapshotsSQL,[published.map(p=>p.publication_id)])).rows as SnapshotRow[];
 return postformeObservations(published,feeds,snapshots).map(o=>({publication_id:o.publication_id,metrics:o.metrics,as_of:o.collected_at,posted_at:o.posted_at,hours_since_publish:o.hours_since_publish,semantics:'lifetime'}));
}
/** Latest published posts (up to 20) that have a reading. */
export async function recentPostMetrics(db:Queryable):Promise<PostMetrics[]>{return measuredPosts(db,(await db.query(postformePublishedSQL)).rows as PublishedRow[]);}
export async function slotPublishing(db:Queryable,slot:string,timezone:string):Promise<SlotPublishing>{
 const publications=(await db.query(slotPublicationsSQL,[slot])).rows as SlotPublication[];
 const measured=await measuredPosts(db,(await db.query(slotPublishedSQL,[slot])).rows as PublishedRow[]);
 return {slot_id:slot,publications,metrics:measured.sort((a,b)=>b.as_of.localeCompare(a.as_of))[0]??null,timezone};
}
