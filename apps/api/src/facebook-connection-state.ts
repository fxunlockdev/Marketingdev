// Integration listing alone cannot distinguish a Facebook login from a selected
// Page. No token/code access is needed to check these scoped observations.
export async function facebookPageConfirmed(db:any,remoteId:string,revision:number,pageId?:string|null):Promise<boolean>{
 const result=await db.query(`SELECT EXISTS(SELECT 1 FROM app.facebook_connection_observations v
 WHERE v.account_revision=$2 AND v.remote_id=$1 AND v.phase='verified' AND ($3::text IS NULL OR v.page_id=$3)
 AND NOT EXISTS(SELECT 1 FROM app.facebook_connection_observations abandoned
 WHERE abandoned.account_revision=$2 AND abandoned.remote_id=$1 AND abandoned.phase='abandoned' AND abandoned.settled_at>=v.settled_at))
 AND NOT EXISTS(SELECT 1 FROM app.facebook_connection_observations
 WHERE account_revision=$2 AND phase='pending' AND (remote_id IS NULL OR remote_id=$1)) AS confirmed`,[remoteId,revision,pageId??null]);
 return result.rows[0].confirmed;
}
