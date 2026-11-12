// Database bootstrap and provider grants for the local stack, through the audited operator paths:
// scripts/bootstrap-database.mjs (roles + every migration) and scripts/configure-providers.mjs
// (workspace defaults, generation plan and per-business grants, preview then apply).
import {randomUUID} from 'node:crypto';
import {bootstrapDatabase,verifyRuntimeLogins} from '../bootstrap-database.mjs';
import {configureProviders} from '../configure-providers.mjs';
import {adminPool} from './containers.mjs';
import {DATABASE_NAME,databaseUrl} from './config.mjs';

const ROLE_FOR_KEY={APP_DATABASE_PASSWORD:'desvio_app',AUTH_DATABASE_PASSWORD:'desvio_auth',MAIL_DATABASE_PASSWORD:'desvio_mail',WORKER_DATABASE_PASSWORD:'desvio_worker',DISPATCHER_DATABASE_PASSWORD:'desvio_dispatcher',POSTIZ_PROVISIONER_DATABASE_PASSWORD:'desvio_provisioner'};

export async function bootstrap(context){
 const passwords=Object.fromEntries(Object.entries(context.secrets.roles).map(([key,value])=>[ROLE_FOR_KEY[key],value]));
 const pool=adminPool(context,1);
 try{
  const result=await bootstrapDatabase(pool,passwords,DATABASE_NAME);
  await verifyRuntimeLogins(databaseUrl(context.ports,'postgres',context.secrets.postgresPassword),passwords);
  return result;
 }catch(error){throw new Error(`Database bootstrap failed: ${error.code??'unexpected error'}`);}
 finally{await pool.end();}
}

const DAY=86400000;
/** Grants expire after at most 31 days by policy; the stack renews them when under a week remains. */
const GRANT_DAYS=30,RENEW_BEFORE=7*DAY;
const LIVE_SHARES={onboarding:0.15,creative:0.5,planning:0.3,insights:0.05};
const MOCK_BUDGET_MICROS=50_000_000;

/** Grant values from the model policy (dist/model-policy.js) with a budget per mode. */
export async function grantSet({mode,spendCapUsd,stock},now=Date.now()){
 const {recommendedGrants}=await import('../../dist/model-policy.js');
 const recommended=recommendedGrants(),expires_at=new Date(now+GRANT_DAYS*DAY).toISOString();
 const budget=kind=>mode==='live'?Math.floor(spendCapUsd*1e6*LIVE_SHARES[kind]):MOCK_BUDGET_MICROS;
 const grants=[
  {kind:'onboarding',enabled:true,expires_at,...recommended.onboarding,budget_micros:budget('onboarding'),max_tokens_per_image:2000},
  {kind:'creative',enabled:true,expires_at,...recommended.creative,quality:mode==='live'?'medium':'low',budget_micros:budget('creative'),max_image_request_micros:Math.min(budget('creative'),500000)},
  {kind:'planning',enabled:true,expires_at,...recommended.planning,budget_micros:budget('planning')},
  {kind:'insights',enabled:true,expires_at,...recommended.insights,budget_micros:budget('insights')},
 ];
 if(stock)grants.push({kind:'stock',enabled:true,expires_at,ai_use_authorized:true,max_daily_downloads:mode==='live'?5:20});
 return grants;
}

async function apply(pool,manifest,mode){
 const options={expectedDatabase:DATABASE_NAME,mode:'development'};
 const preview=await configureProviders(pool,manifest,options);
 if(preview.status!=='preview')return preview;
 return configureProviders(pool,manifest,{...options,approval:preview.preview_sha256});
}

const operatorReference=mode=>`local-stack ${mode} mode`;
/** Renews workspace defaults, the account generation plan and every business's grants. Idempotent. */
export async function refreshGrants(context,pool){
 const {mode}=context,now=Date.now(),applied=[];
 const grants=await grantSet(context,now);
 const organizations=(await pool.query(`SELECT o.id,d.grants,p.organization_id IS NOT NULL AS has_plan FROM app.organizations o
  LEFT JOIN app.workspace_provider_defaults d ON d.organization_id=o.id LEFT JOIN app.generation_plans p ON p.organization_id=o.id`)).rows;
 for(const org of organizations){
  if(!org.has_plan){await apply(pool,{version:1,change_id:randomUUID(),organization_id:org.id,operator_reference:operatorReference(mode),scope:'generation_plan',monthly_price_usd:500,enabled:true},mode);applied.push(`plan:${org.id}`);}
  const soonest=Math.min(...(org.grants??[]).map(g=>Date.parse(g.expires_at)));
  const stale=!org.grants||soonest-now<RENEW_BEFORE||JSON.stringify((org.grants??[]).map(g=>g.kind).sort())!==JSON.stringify(grants.map(g=>g.kind).sort())||org.grants.some(g=>g.kind!=='stock'&&g.budget_micros!==grants.find(x=>x.kind===g.kind)?.budget_micros);
  if(stale){await apply(pool,{version:1,change_id:randomUUID(),organization_id:org.id,operator_reference:operatorReference(mode),scope:'workspace_defaults',grants},mode);applied.push(`defaults:${org.id}`);}
 }
 const businesses=(await pool.query(`SELECT b.organization_id,b.id,
  (SELECT min(expires_at) FROM (SELECT expires_at FROM app.planning_grants g WHERE g.brand_id=b.id AND g.enabled
   UNION ALL SELECT expires_at FROM app.creative_grants g WHERE g.brand_id=b.id AND g.enabled
   UNION ALL SELECT expires_at FROM app.analysis_grants g WHERE g.brand_id=b.id AND g.enabled) e) AS expires_at,
  (SELECT count(*) FROM (SELECT 1 FROM app.planning_grants g WHERE g.brand_id=b.id AND g.enabled UNION ALL SELECT 1 FROM app.creative_grants g WHERE g.brand_id=b.id AND g.enabled UNION ALL SELECT 1 FROM app.analysis_grants g WHERE g.brand_id=b.id AND g.enabled) c)::int AS granted,
  (SELECT budget_micros FROM app.planning_grants g WHERE g.brand_id=b.id) AS planning_budget
  FROM app.brands b`)).rows;
 const planningBudget=grants.find(g=>g.kind==='planning').budget_micros;
 for(const b of businesses){
  const fresh=b.granted===3&&b.expires_at&&b.expires_at.getTime()-now>=RENEW_BEFORE&&Number(b.planning_budget)===planningBudget;
  if(fresh)continue;
  await apply(pool,{version:1,change_id:randomUUID(),organization_id:b.organization_id,business_id:b.id,operator_reference:operatorReference(mode),grants},mode);
  applied.push(`business:${b.id}`);
 }
 return applied;
}
