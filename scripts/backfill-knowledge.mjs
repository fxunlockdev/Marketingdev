// One-off operator back-fill: turn every business's latest approved brand profile into approved knowledge.
// Dry run by default (reports what would change, writes nothing). Pass --apply to write.
// Runs with MIGRATION_DATABASE_URL (the operator policy on the knowledge tables); never import into a service.
// Idempotent: applying twice only moves last_seen. Requires `npm run build` first (imports from dist/).
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
import {applyMutations} from '../dist/knowledge-graph.js';
import {fromBrandBrainSnapshot} from '../dist/knowledge-extract.js';

const LATEST=`SELECT DISTINCT ON (v.organization_id,v.brand_id) v.organization_id,v.brand_id,v.id,v.snapshot,v.approved_by
 FROM app.brand_brain_versions v JOIN app.brands b ON b.organization_id=v.organization_id AND b.id=v.brand_id
 WHERE ($1::uuid IS NULL OR v.brand_id=$1) ORDER BY v.organization_id,v.brand_id,v.review_revision DESC`;

/** Per business: how many nodes and edges the profile maps to, and how many are new. */
export async function backfillKnowledge(pool,{apply=false,brandId=null}={}){
 const {rows}=await pool.query(LATEST,[brandId]);
 const report=[];
 for(const version of rows){
  const scope={organizationId:version.organization_id,brandId:version.brand_id};
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const mutations=fromBrandBrainSnapshot(version.snapshot);
   const result=await applyMutations(client,scope,mutations,{actor:version.approved_by});
   // A dry run performs the same writes and rolls them back, so the counts are exact.
   await client.query(apply?'COMMIT':'ROLLBACK');
   report.push({brand_id:version.brand_id,version_id:version.id,nodes:mutations.nodes.length,edges:mutations.edges.length,
    new_nodes:result.nodes.filter(n=>n.outcome==='inserted').length,new_edges:result.edges.filter(e=>e.outcome==='inserted').length,applied:apply});
  }catch(error){
   await client.query('ROLLBACK');
   report.push({brand_id:version.brand_id,version_id:version.id,error:typeof error?.code==='string'?error.code:'BACKFILL_FAILED',applied:false});
  }finally{client.release();}
 }
 return report;
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL is required; never use it in the runtime');
 const brand=process.argv.find(a=>a.startsWith('--brand='))?.slice(8)??null;
 const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL,max:1});
 try{
  const report=await backfillKnowledge(pool,{apply:process.argv.includes('--apply'),brandId:brand});
  process.stdout.write(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',businesses:report.length,report},null,1)+'\n');
  if(report.some(r=>r.error))process.exitCode=1;
 }finally{await pool.end();}
}
