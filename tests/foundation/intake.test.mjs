import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import OpenAI from "openai";
import { TenantDatabase } from "../../dist/database.js";
import { Workspaces } from "../../dist/workspaces.js";
import { Businesses } from "../../dist/businesses.js";
import { Intake } from "../../dist/intake.js";
import { IntakeJobs } from "./capture-fixture.mjs";
import { AssetJobs } from "../../dist/jobs.js";
import { BrandBrain } from "../../dist/brand-brain.js";
import { BrandAnalyzer } from "../../dist/brand-analysis.js";
import { fixtureVisual, VISUAL_VERSION } from "./capture-fixture.mjs";
import { ObjectStore } from "../../dist/object-store.js";
const config = JSON.parse(process.env.DESVIO_TEST_CONFIG),
  admin = new Pool({ connectionString: process.env.DESVIO_TEST_ADMIN_URL }),
  app = new Pool({ connectionString: config.appDatabaseUrl }),
  worker = new Pool({ connectionString: config.jobs.workerDatabaseUrl });
const database = new TenantDatabase(app),
  workspaces = new Workspaces(database),
  businesses = new Businesses(database, workspaces),
  intake = new Intake(businesses),
  brain = new BrandBrain(database),
  jobs = new AssetJobs(worker, null, null),
  parser = true;
const alice = randomUUID(),
  bob = randomUUID();
let org, brand, capturedVisual;
const reader = undefined;
const scope = (j) => ({
  organizationId: org.id,
  brandId: brand.id,
  jobId: j.id,
});
const row = async (j) =>
  (await admin.query("SELECT * FROM app.jobs WHERE id=$1", [j.id])).rows[0];
const submit = (kind) => intake.submit(alice, brand.id, { kind }, randomUUID());
async function grant(budget = 1000000) {
  await admin.query(
    "INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',$3,1,1,'LOCAL TEST ONLY',true) ON CONFLICT(organization_id,brand_id) DO UPDATE SET budget_micros=$3,enabled=true",
    [org.id, brand.id, budget],
  );
}
function analyzer(callback) {
  return new BrandAnalyzer(
    undefined,
    new OpenAI({ apiKey: "fixture-only", maxRetries: 0, fetch: callback }),
  );
}
function output(init) {
  const input = JSON.parse(JSON.parse(init.body).input),
    chunk = input.chunks.find((c) => c.text.includes("scheduling tools"));
  return {
    findings: [
      {
        field: "offering",
        value: "Scheduling tools for dental practices",
        chunk_id: chunk.id,
        quote: "scheduling tools for dental practices",
      },
    ],
    recommendation: {
      goal: "leads",
      audience: "Dental practices",
      channels: ["linkedin"],
      cadence: 3,
      reason: "The business serves dental practices.",
      chunk_ids: [chunk.id],
    },
    missing: ["Brand voice"],
  };
}
function response(result) {
  return Response.json({
    object: "response",
    id: "resp_mock",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(result),
            annotations: [],
          },
        ],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
  });
}
before(async () => {
  capturedVisual = await fixtureVisual();
  for (const id of [alice, bob])
    await admin.query(
      'INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$1::text,$2,true)',
      [id, `${id}@example.test`],
    );
  org = await workspaces.create(alice, { name: "Intake account" });
  brand = await workspaces.createBrand(
    alice,
    org.id,
    { name: "Acme", website: "https://example.org/" },
    randomUUID(),
  );
});
after(async () => {
  await Promise.all([admin.end(), app.end(), worker.end()]);
});
test("captured evidence provenance and idempotent scoped jobs (MOCK capture provider)", async () => {
  const key = randomUUID(),
    j = await intake.submit(alice, brand.id, { kind: "website.extract" }, key);
  assert.equal(
    (await intake.submit(alice, brand.id, { kind: "website.extract" }, key)).id,
    j.id,
  );
  await assert.rejects(intake.read(bob, brand.id), /not found/i);
  await assert.rejects(
    intake.submit(alice, brand.id, { kind: "brand.analyze" }, key),
    /already used/,
  );
  await assert.rejects(
    intake.submit(alice, brand.id, { kind: "website.extract" }, randomUUID()),
    /already running/,
  );
  const handler = new IntakeJobs(jobs, parser, new BrandAnalyzer(), reader);
  assert.equal(await handler.run(scope(j)), "succeeded");
  const b = await brain.read(alice, org.id, brand.id);
  assert.equal(b.sources.length, 1);
  assert.equal(b.sources[0].website_url, "https://example.org/");
  assert.equal(b.findings.length, 0);
  const source = await brain.source(alice, org.id, brand.id, b.sources[0].id);
  assert.ok(source.chunks[0].text.includes("scheduling tools"));
  assert.ok(!source.chunks[0].text.includes("169.254"));
  assert.equal(
    (await intake.read(alice, brand.id)).jobs[0].result.skipped[0].code,
    "WEBSITE_ROBOTS_DISALLOWED",
  );
  const again = await submit("website.extract");
  await handler.run(scope(again));
  assert.equal((await brain.read(alice, org.id, brand.id)).sources.length, 1);
  await assert.rejects(
    jobs.transaction({ ...scope(j), brandId: randomUUID() }, async () => true),
    /JOB_SCOPE_DENIED/,
  );
});
test("AI requires a server key and operator grant; no prefilled fake defaults", async () => {
  const missing = await submit("brand.analyze");
  await new IntakeJobs(jobs, parser, new BrandAnalyzer(), reader).run(
    scope(missing),
  );
  assert.equal((await row(missing)).error_code, "AI_NOT_CONFIGURED");
  let calls = 0;
  const denied = await submit("brand.analyze");
  await new IntakeJobs(
    jobs,
    parser,
    analyzer(async () => {
      calls++;
      throw Error();
    }),
    reader,
  ).run(scope(denied));
  assert.equal((await row(denied)).error_code, "AI_STAGING_APPROVAL_REQUIRED");
  assert.equal(calls, 0);
});
test("AI grounded findings and recommended goals persist without approving or overwriting owner settings (MOCK provider)", async () => {
  await grant();
  await businesses.onboarding(alice, brand.id, {
    revision: 0,
    step: 3,
    goal: "sales",
    timezone: "UTC",
    cadence: 5,
    channels: ["instagram"],
    must_avoid: "No discounts",
  });
  let calls = 0;
  const handler = new IntakeJobs(
      jobs,
      parser,
      analyzer(async (_url, init) => {
        calls++;
        return response(output(init));
      }),
      reader,
    ),
    j = await submit("brand.analyze");
  assert.equal(await handler.run(scope(j)), "succeeded");
  assert.equal(await handler.run(scope(j)), "finished");
  assert.equal(calls, 1);
  const b = await brain.read(alice, org.id, brand.id);
  assert.equal(b.findings[0].extraction_type, "ai_suggestion");
  assert.equal(b.findings[0].status, "unreviewed");
  assert.equal(b.active, null);
  assert.equal(
    (await intake.read(alice, brand.id)).recommendation.recommendation.goal,
    "leads",
  );
  assert.equal((await businesses.onboarding(alice, brand.id)).goal, "sales");
  await assert.rejects(
    app.query("UPDATE app.analysis_grants SET enabled=true"),
    /permission denied/,
  );
});
test("unknown provider outcomes and interrupted submissions never automatically repeat paid calls", async () => {
  const captureKey = randomUUID();
  const capture = await intake.submit(alice, brand.id, {kind: "website.extract"}, captureKey);
  await admin.query("UPDATE app.jobs SET status='unknown',error_code='MAXUN_SUBMISSION_UNKNOWN' WHERE id=$1", [capture.id]);
  // Replaying the same request may inspect its result, but a new key must not
  // silently authorize a second potentially paid capture.
  assert.equal((await intake.submit(alice, brand.id, {kind: "website.extract"}, captureKey)).id, capture.id);
  await assert.rejects(submit("website.extract"), /uncertain outcome/);
  await admin.query("UPDATE app.jobs SET status='rejected' WHERE id=$1", [capture.id]);
  let calls = 0;
  const handler = new IntakeJobs(
      jobs,
      parser,
      analyzer(async () => {
        calls++;
        throw new TypeError("MOCK connection lost");
      }),
      reader,
    ),
    j = await submit("brand.analyze");
  assert.equal(await handler.run(scope(j)), "unknown");
  await handler.run(scope(j));
  assert.equal(calls, 1);
  await assert.rejects(submit("brand.analyze"), /uncertain outcome/);
  await admin.query("UPDATE app.jobs SET status='rejected' WHERE id=$1", [
    j.id,
  ]); // Test-only simulation of an operator resolving the unknown result.
  const interrupted = await submit("brand.analyze");
  await admin.query(
    "INSERT INTO app.analysis_calls(job_id,organization_id,brand_id,review_revision,model,reserved_micros,input_sha256,status) VALUES($1,$2,$3,0,'MOCK-model',1,'test','submitted')",
    [interrupted.id, org.id, brand.id],
  );
  await handler.run(scope(interrupted));
  assert.equal((await row(interrupted)).status, "unknown");
  assert.equal(calls, 1);
  await admin.query("UPDATE app.jobs SET status='rejected' WHERE id=$1", [
    interrupted.id,
  ]);
});
test("cancellation, evidence edits during AI calls and insufficient budget preserve existing work", async () => {
  const canceled = await submit("website.extract");
  await admin.query("UPDATE app.jobs SET cancel_requested=true WHERE id=$1", [
    canceled.id,
  ]);
  await new IntakeJobs(jobs, parser, new BrandAnalyzer(), reader).run(
    scope(canceled),
  );
  assert.equal((await row(canceled)).status, "canceled");
  const j = await submit("brand.analyze");
  const handler = new IntakeJobs(
    jobs,
    parser,
    analyzer(async (_url, init) => {
      await brain.manual(
        alice,
        org.id,
        brand.id,
        { field: "voice", value: "Warm" },
        randomUUID(),
      );
      return response(output(init));
    }),
    reader,
  );
  await handler.run(scope(j));
  assert.equal((await row(j)).error_code, "AI_EVIDENCE_CHANGED");
  await grant(1);
  let calls = 0;
  const exhausted = await submit("brand.analyze");
  await new IntakeJobs(
    jobs,
    parser,
    analyzer(async () => {
      calls++;
      throw Error();
    }),
    reader,
  ).run(scope(exhausted));
  assert.equal((await row(exhausted)).error_code, "AI_BUDGET_EXHAUSTED");
  assert.equal(calls, 0);
  assert.equal(
    (await businesses.onboarding(alice, brand.id)).must_avoid,
    "No discounts",
  );
});
test("fresh onboarding pre-fills persisted AI suggestions and protects later user edits", async () => {
  const old = brand;
  brand = await workspaces.createBrand(
    alice,
    org.id,
    { name: "Fresh onboarding" },
    randomUUID(),
  );
  try {
    await brain.manual(
      alice,
      org.id,
      brand.id,
      {
        field: "products",
        value: "Acme makes scheduling tools for dental practices.",
      },
      randomUUID(),
    );
    await grant();
    const j = await submit("brand.analyze");
    await new IntakeJobs(
      jobs,
      parser,
      analyzer(async (_url, init) => response(output(init))),
      reader,
    ).run(scope(j));
    assert.equal((await row(j)).status, "succeeded");
    const suggested = await businesses.onboarding(alice, brand.id);
    assert.equal(suggested.prefilled, true);
    assert.equal(suggested.goal, "leads");
    assert.deepEqual(suggested.channels, ["linkedin"]);
    assert.equal(suggested.recommendation.model, "MOCK-model");
    await businesses.onboarding(alice, brand.id, {
      revision: 0,
      step: 3,
      goal: "traffic",
      timezone: "UTC",
      cadence: 2,
      channels: [],
      must_avoid: "No hype",
      preferences_edited: true,
    });
    const saved = await businesses.onboarding(alice, brand.id);
    assert.equal(saved.prefilled, false);
    assert.equal(saved.goal, "traffic");
    assert.equal(saved.must_avoid, "No hype");
    const f = (await brain.read(alice, org.id, brand.id)).findings[0];
    await brain.review(alice, org.id, brand.id, f.id, {
      revision: f.revision,
      decision: "edited",
      value: "Owner correction",
    });
    assert.equal(
      (await businesses.onboarding(alice, brand.id)).recommendation.stale,
      true,
    );
    // Creative workers may read their bound snapshot. An intake job must not
    // inherit that read grant; RLS denies every approved snapshot here.
    assert.equal((await jobs.transaction(scope(j), (db) =>
      db.query("SELECT * FROM app.brand_brain_versions"),
    )).rowCount, 0);
  } finally {
    brand = old;
  }
});
test(
  "captured screenshots persist in private storage and tenant-bound downloads",
  { skip: config.storage.endpoint.endsWith(":1") },
  async () => {
    assert.ok(
      capturedVisual,
      "Mock capture pixels must be available for storage tests",
    );
    const store = new ObjectStore(config.storage);
    try {
      const handler = new IntakeJobs(
        new AssetJobs(worker, store, null),
        parser,
        new BrandAnalyzer(),
        reader,
        { capture: async () => capturedVisual },
      );
      const j = await submit("website.extract");
      assert.equal(await handler.run(scope(j)), "succeeded");
      const service = new Intake(businesses, store),
        state = await service.read(alice, brand.id);
      assert.equal(state.visuals.length, 2);
      assert.ok(state.visuals.every((v) => !("object_key" in v)));
      const signed = await service.visual(alice, brand.id, state.visuals[0].id),
        download = await fetch(signed.url);
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-type"), "image/jpeg");
      assert.ok((await download.arrayBuffer()).byteLength > 1000);
      await assert.rejects(
        service.visual(bob, brand.id, state.visuals[0].id),
        /not found/i,
      );
      await assert.rejects(
        service.visual(alice, brand.id, randomUUID()),
        /not found/i,
      );
      const source = (await brain.read(alice, org.id, brand.id)).sources.find(
        (s) => s.parser_version === VISUAL_VERSION,
      );
      assert.equal(source.coverage.type, "rendered_desktop_mobile");
      let calls = 0;
      const visionAnalyzer = analyzer(async (url, init) => {
        calls++;
        const body = JSON.parse(init.body),
          content = body.input[0].content;
        const evidence = JSON.parse(content[0].text),
          images = content.filter((c) => c.type === "input_image");
        assert.ok(images.length >= 2);
        assert.ok(
          images.every((i) =>
            i.image_url.startsWith("data:image/jpeg;base64,"),
          ),
        );
        assert.ok(
          evidence.visual_manifest.every((m) =>
            state.visuals.some((v) => v.id === m.visual_id),
          ),
        );
        return response({
          findings: [],
          recommendation: null,
          missing: [],
          visual_guidance: [
            {
              category: "composition",
              observation: "TEST interpretation of captured pixels",
              creative_direction: "TEST suggestion requiring human review",
              image_ids: [evidence.visual_manifest[0].id],
            },
          ],
        });
      });
      const visionHandler = new IntakeJobs(
        new AssetJobs(worker, store, null),
        parser,
        visionAnalyzer,
        reader,
      );
      await grant(10000000);
      const denied = await submit("brand.analyze");
      assert.equal(await visionHandler.run(scope(denied)), "rejected");
      assert.equal(
        (await row(denied)).error_code,
        "AI_VISION_APPROVAL_REQUIRED",
      );
      assert.equal(calls, 0);
      await admin.query(
        "UPDATE app.analysis_grants SET max_tokens_per_image=10000 WHERE organization_id=$1 AND brand_id=$2",
        [org.id, brand.id],
      );
      const analyzed = await submit("brand.analyze");
      assert.equal(await visionHandler.run(scope(analyzed)), "succeeded");
      assert.equal(calls, 1);
      const saved = (await service.read(alice, brand.id)).jobs.find(
        (j) => j.id === analyzed.id,
      ).result;
      assert.equal(saved.visual_guidance.length, 1);
      assert.ok(saved.visual_manifest.every((v) => !v.image && !v.object_key));
      assert.ok(
        (
          await admin.query(
            "SELECT reserved_micros FROM app.analysis_calls WHERE job_id=$1",
            [analyzed.id],
          )
        ).rows[0].reserved_micros >=
          saved.visual_manifest.length * 10000,
      );
      assert.equal(await visionHandler.run(scope(analyzed)), "finished");
      assert.equal(calls, 1);
      const wrongScope = { ...scope(analyzed), brandId: randomUUID() };
      await assert.rejects(visionHandler.run(wrongScope), /JOB_SCOPE_DENIED/);
    } finally {
      store.close();
    }
  },
);

test("Maxun intake persists formats, text and screenshots into real scoped brand evidence (MOCK Cloud; real storage when configured)",async()=>{
 const {MaxunIntake}=await import('../../dist/maxun-intake.js');
 const sharp=(await import('sharp')).default;
 const {digest}=await import('../../dist/object-store.js');
 const business=await workspaces.createBrand(alice,org.id,{name:'Maxun fixture',website:'https://example.com/'},randomUUID());
 const captureKey=randomUUID();
 const submitted=await intake.submit(alice,business.id,{kind:'website.extract',autoAnalyze:true},captureKey);
 assert.equal((await intake.submit(alice,business.id,{kind:'website.extract',autoAnalyze:true},captureKey)).id,submitted.id);
 const child=(await intake.read(alice,business.id)).jobs.find(j=>j.kind==='brand.analyze');
 assert.ok(child);
 assert.equal((await intake.read(alice,business.id)).jobs.find(j=>j.id===submitted.id).auto_analysis_job_id,child.id);
 const scoped={organizationId:org.id,brandId:business.id,jobId:submitted.id};
 const persistedStore=config.storage?new ObjectStore(config.storage):null;
 const objects=new Map(),store={persist:async(key,bytes,type,sha)=>{assert.equal(digest(bytes),sha);assert.equal(key.split("/").at(-1),sha);objects.set(key,{bytes,type});if(persistedStore)await persistedStore.persist(key,bytes,type,sha);},read:async(key,max)=>persistedStore?persistedStore.read(key,max):objects.get(key).bytes};
 const image=await sharp({create:{width:1280,height:1800,channels:3,background:'#bada55'}}).jpeg().toBuffer();
 const cloud=new MaxunIntake({capture:async()=>({run:{runId:randomUUID(),robotId:randomUUID()},partial:false,media:[],output:{crawlData:[{metadata:{url:'https://example.com/',title:'Acme'},text:'Acme makes scheduling tools.',markdown:'# Acme',html:'<h1>Acme</h1>',links:[],screenshotFullpage:'crawl-1-screenshot-fullpage'}]}})},async()=>({bytes:image,sha256:digest(image),width:1280,height:1800,kind:'fullpage'}));
 const isolatedJobs=new AssetJobs(worker,store,null);
 const pipeline=new IntakeJobs(isolatedJobs,undefined,new BrandAnalyzer(),undefined,undefined,cloud);
 assert.equal(await pipeline.run({...scoped,jobId:child.id}),'waiting');
 assert.equal((await row(child)).attempt,0);
 assert.equal(await pipeline.run(scoped),'succeeded');
 const sources=(await admin.query("SELECT * FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2",[org.id,business.id])).rows;
 assert.equal(sources.length,1);assert.equal(sources[0].parser_version,'maxun-cloud-v1/desvio-v1');
 const chunks=(await admin.query('SELECT text FROM app.brand_chunks WHERE source_id=$1',[sources[0].id])).rows;
 assert.equal(chunks[0].text,'Acme makes scheduling tools.');
 const visuals=(await admin.query('SELECT * FROM app.website_visuals WHERE source_id=$1',[sources[0].id])).rows;
 assert.equal(visuals.length,1);assert.equal(visuals[0].viewport,'fullpage');assert.equal(visuals[0].width,1280);
 assert.equal(objects.size,2);assert.ok([...objects.keys()].every(k=>k.startsWith(`evidence/${org.id}/${business.id}/${submitted.id}/`)));
 const raw=[...objects.values()].find(o=>o.type==='application/json');assert.equal(JSON.parse(raw.bytes).output.crawlData[0].html,'<h1>Acme</h1>');
 const saved=(await admin.query('SELECT result FROM app.intake_requests WHERE job_id=$1',[submitted.id])).rows[0].result;
 assert.equal(saved.coverage,'rendered_provider');assert.equal(saved.visualErrors.length,0);
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_tokens_per_image,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',100000000,1,1,10000,'LOCAL TEST ONLY',true)",[org.id,business.id]);
 let modelCalls=0;
 const model=analyzer(async(_url,init)=>{
  modelCalls++;
  const request=JSON.parse(init.body),evidence=JSON.parse(request.input[0].content[0].text);
  assert.ok(request.input[0].content.some(c=>c.type==='input_image'));
  const chunk=evidence.chunks.find(c=>c.text==='Acme makes scheduling tools.');assert.ok(chunk);
  return response({findings:[{field:'brand_name',value:'Acme',chunk_id:chunk.id,quote:'Acme'}],recommendation:null,missing:[],visual_guidance:[]});
 });
 // The child was already persisted before capture; no browser submission is needed.
 const analysisJob=child;
 const analyzed=await new IntakeJobs(isolatedJobs,undefined,model).run({...scoped,jobId:analysisJob.id});
 assert.equal(analyzed,'succeeded');assert.equal(modelCalls,1);
 assert.equal((await intake.read(alice,business.id)).jobs[0].id,analysisJob.id);
 assert.equal(await new IntakeJobs(isolatedJobs,undefined,model).run({...scoped,jobId:analysisJob.id}),'finished');
 assert.equal(modelCalls,1);
 const profile=await brain.read(alice,org.id,business.id);
 assert.ok(profile.findings.some(f=>f.field==='brand_name'&&f.value==='Acme'&&f.status==='unreviewed'));

 if(persistedStore){
  try{
   for(const [key,value] of objects)assert.deepEqual(await persistedStore.read(key,20*1024*1024),value.bytes);
   const service=new Intake(businesses,persistedStore),signed=await service.visual(alice,business.id,visuals[0].id);
   const download=await fetch(signed.url);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),image);
   await assert.rejects(service.visual(bob,business.id,visuals[0].id),/not found/i);
  }finally{persistedStore.close();}
 }
});

test("Maxun checkpoints use real job RLS, atomic claims and deny other job contexts", async () => {
 const {maxunJournal}=await import('../../dist/maxun-journal.js');
 const first=await submit('website.extract');
 const other=(await admin.query('SELECT id FROM app.brands WHERE organization_id=$1 AND id<>$2 AND website IS NOT NULL ORDER BY id LIMIT 1',[org.id,brand.id])).rows[0];
 const second=await intake.submit(alice,other.id,{kind:'website.extract'},randomUUID());
 const secondScope={...scope(second),brandId:other.id};
 const a=maxunJournal(jobs,scope(first)),b=maxunJournal(jobs,secondScope);
 assert.equal(await a.load(),null);
 const claims=await Promise.all([a.replace(null,{phase:'creating'}),a.replace(null,{phase:'creating'})]);
 assert.equal(claims.filter(Boolean).length,1);
 assert.deepEqual(await a.load(),{phase:'creating'});assert.equal(await b.load(),null);
 await jobs.transaction(secondScope,async(db)=>{
  assert.equal((await db.query('SELECT * FROM app.website_capture_calls WHERE job_id=$1',[first.id])).rowCount,0);
  assert.equal((await db.query("UPDATE app.website_capture_calls SET checkpoint='{\"phase\":\"polling\"}' WHERE job_id=$1",[first.id])).rowCount,0);
 });
 assert.equal(await a.replace({phase:'created'},{phase:'submitting'}),false);
 assert.equal((await app.query('SELECT * FROM app.website_capture_calls')).rowCount,0); // Recovery metadata is readable only with authenticated tenant/business context.
 await assert.rejects(maxunJournal(jobs,{...scope(first),brandId:randomUUID()}).load(),/JOB_SCOPE_DENIED/);
 await admin.query('UPDATE app.jobs SET cancel_requested=true WHERE id=$1',[first.id]);
 assert.equal(await a.permitted(),false);
 await assert.rejects(a.replace({phase:'creating'},{phase:'created'}),/ACCESS_REVOKED/);
 await admin.query("UPDATE app.jobs SET status='canceled' WHERE id=ANY($1::uuid[])",[[first.id,second.id]]);
});


test('durable onboarding dependencies cancel after failed capture and cannot expose or mutate unrelated jobs',async()=>{
 const business=(await admin.query("SELECT id FROM app.brands WHERE organization_id=$1 AND name='Maxun fixture'",[org.id])).rows[0];
 const handler=new IntakeJobs(jobs,undefined,analyzer(async()=>{throw Error('MODEL_MUST_NOT_RUN');}));
 for(const parentState of ['failed','unknown','canceled']){
  const parent=await intake.submit(alice,business.id,{kind:'website.extract',autoAnalyze:true},randomUUID());
  const child=(await intake.read(alice,business.id)).jobs.find(j=>j.kind==='brand.analyze'&&j.status==='queued');
  const sc={organizationId:org.id,brandId:business.id,jobId:child.id};
  await jobs.transaction(sc,async db=>{
   assert.equal((await db.query('SELECT id FROM app.jobs WHERE id=$1',[parent.id])).rowCount,1);
   assert.equal((await db.query("UPDATE app.jobs SET status='failed' WHERE id=$1",[parent.id])).rowCount,0);
   assert.equal((await db.query('SELECT id FROM app.jobs WHERE brand_id<>$1',[business.id])).rowCount,0);
  });
  await admin.query('UPDATE app.jobs SET status=$2 WHERE id=$1',[parent.id,parentState]);
  assert.equal(await handler.run(sc),'finished');
  assert.equal((await row(child)).status,'canceled');
  assert.equal((await row(child)).error_code,'WEBSITE_PREREQUISITE_FAILED');
  await admin.query("UPDATE app.jobs SET status='rejected' WHERE id=$1",[parent.id]);
 }
 const timeoutParent=await intake.submit(alice,business.id,{kind:'website.extract',autoAnalyze:true},randomUUID());
 const timeoutChild=(await intake.read(alice,business.id)).jobs.find(j=>j.kind==='brand.analyze'&&j.status==='queued');
 assert.equal(await handler.fail({organizationId:org.id,brandId:business.id,jobId:timeoutChild.id}),'failed');
 assert.equal((await row(timeoutChild)).error_code,'WEBSITE_PREREQUISITE_TIMEOUT');
 await admin.query("UPDATE app.jobs SET status='canceled' WHERE id=$1",[timeoutParent.id]);
 await assert.rejects(intake.submit(alice,business.id,{kind:'brand.analyze',autoAnalyze:true},randomUUID()),/only available/);
});

test('Temporal resumes the capture-to-analysis wait after worker restart without a browser', {skip:!config.storage}, async()=>{
 const {Worker,NativeConnection}=await import('@temporalio/worker');
 const {Client,Connection}=await import('@temporalio/client');
 const {fileURLToPath}=await import('node:url');
 const native=await NativeConnection.connect({address:config.jobs.address});
 const connection=await Connection.connect({address:config.jobs.address});
 const client=new Client({connection,namespace:config.jobs.namespace});
 let calls=0,first,second,run;
 let observed;const waiting=new Promise(resolve=>{observed=resolve;});
 const options={connection:native,namespace:config.jobs.namespace,taskQueue:'intake-restart-'+randomUUID(),workflowsPath:fileURLToPath(new URL('../../dist/asset-workflow.js',import.meta.url)),activities:{processIntake:async()=>{calls++;if(calls===1){observed();return 'waiting';}return 'succeeded';},failIntake:async()=>{throw Error('UNEXPECTED_FINALIZATION');}}};
 try{
  first=await Worker.create(options);run=first.run();
  const handle=await client.workflow.start('processIntakeWorkflow',{workflowId:'intake-restart-'+randomUUID(),taskQueue:options.taskQueue,args:[{organizationId:org.id,brandId:brand.id,jobId:randomUUID()}]});
  await waiting;
  first.shutdown();await run;first=undefined;
  second=await Worker.create(options);
  assert.equal(await second.runUntil(()=>handle.result()),'succeeded');second=undefined;
  assert.equal(calls,2);
 }finally{
  if(first){first.shutdown();await run.catch(()=>{});}
  await native.close();await connection.close();
 }
});

test('lost Maxun execution response reconciles through persisted job checkpoint without paying twice (MOCK Cloud)',async()=>{
 const {MaxunClient}=await import('../../dist/maxun-client.js');
 const {MaxunWorkflow}=await import('../../dist/maxun-workflow.js');
 const {maxunJournal}=await import('../../dist/maxun-journal.js');
 const job=await submit('website.extract'),sc=scope(job),robotId=randomUUID(),runId=randomUUID();let posts=0,lookups=0;
 const provider=new MaxunClient('fixture',async(url,options)=>{
  if(options.method==='POST'){
   if(url.pathname.endsWith('/crawl')){const body=JSON.parse(options.body);return Response.json({success:true,data:{id:robotId,name:body.name,type:'crawl',url:body.url}});}
   posts++;throw Error('accepted by provider but response lost');
  }
  if(url.pathname===`/api/v1/robots/${robotId}/runs`){lookups++;return Response.json({success:true,data:[{id:runId,robotId,source:'api',startedAt:url.searchParams.get('since')}]});}
  assert.equal(url.pathname,`/api/v1/runs/${runId}`);
  return Response.json({success:true,data:{id:runId,robotId,status:'success',data:{crawlData:[]},screenshots:[]}});
 });
 try{
  const workflow=new MaxunWorkflow(provider,async()=>{}),journal=maxunJournal(jobs,sc);
  assert.equal((await workflow.capture(sc,'https://example.org/',journal)).run.runId,runId);
  assert.deepEqual(await journal.load(),{phase:'polling',robotId,runId});
  const restarted=new MaxunWorkflow(provider,async()=>{});
  assert.equal((await restarted.capture(sc,'https://example.org/',maxunJournal(jobs,sc))).run.runId,runId);
  assert.equal(posts,1);assert.equal(lookups,1);
 }finally{await admin.query("UPDATE app.jobs SET status='canceled' WHERE id=$1",[job.id]);}
});

test('terminal unknown capture recovery is tenant-scoped, idempotent and read-only at the provider',async()=>{
 const {maxunJournal}=await import('../../dist/maxun-journal.js');
 const {MaxunClient}=await import('../../dist/maxun-client.js');
 const {MaxunWorkflow}=await import('../../dist/maxun-workflow.js');
 const {MaxunIntake}=await import('../../dist/maxun-intake.js');
 const {IntakeJobs:ProductionIntakeJobs}=await import('../../dist/intake-jobs.js');
 const original=await submit('website.extract'),originalScope=scope(original),robotId=randomUUID(),runId=randomUUID();
 const checkpoint={phase:'polling',robotId,runId};
 assert.equal(await maxunJournal(jobs,originalScope).replace(null,checkpoint),true);
 await admin.query("UPDATE app.jobs SET status='unknown',error_code='MAXUN_SUBMISSION_UNKNOWN' WHERE id=$1",[original.id]);
 const initial=await intake.read(alice,brand.id);
 assert.equal(initial.jobs.find(j=>j.id===original.id).can_recover,true);
 assert.ok(!JSON.stringify(initial).includes(runId));assert.ok(!JSON.stringify(initial).includes(robotId));
 await assert.rejects(intake.submit(bob,brand.id,{kind:'website.extract',recoverJobId:original.id},randomUUID()),/not found/i);
 await assert.rejects(intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id,autoAnalyze:true},randomUUID()),/does not start paid AI/);
 const key=randomUUID(),recovery=await intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id},key);
 assert.equal((await intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id},key)).id,recovery.id);
 await assert.rejects(intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id},randomUUID()),/already running/);
 const store=new ObjectStore(config.storage),recoveryJobs=new AssetJobs(worker,store,null),recoveryScope=scope(recovery),requests=[];
 const client=new MaxunClient('fixture',async(url,options)=>{
  assert.equal(options.method,'GET');requests.push(url.pathname);
  assert.equal(url.pathname,`/api/v1/runs/${runId}`);
  return Response.json({success:true,data:{id:runId,robotId,status:'success',data:{crawlData:[{metadata:{url:'https://example.org/',title:'Acme'},text:'Acme recovered scheduling tools.',markdown:'# Acme',html:'<h1>Acme</h1>',links:[]}]},screenshots:[]}});
 });
 try{
  const handler=new ProductionIntakeJobs(recoveryJobs,new BrandAnalyzer(),new MaxunIntake(new MaxunWorkflow(client,async()=>{})));
  assert.equal(await handler.run(recoveryScope),'succeeded');assert.equal(requests.length,1);
  assert.equal((await row(original)).status,'unknown');assert.deepEqual(await maxunJournal(jobs,originalScope).load(),checkpoint);
  assert.equal((await intake.read(alice,brand.id)).jobs.find(j=>j.id===original.id).can_recover,false);
  assert.equal((await intake.read(alice,brand.id)).jobs.find(j=>j.id===recovery.id).recovery_of,original.id);
  await assert.rejects(intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id},randomUUID()),/already been recovered/);
  const later=await submit('website.extract');await admin.query("UPDATE app.jobs SET status='canceled' WHERE id=$1",[later.id]);
  await recoveryJobs.transaction(recoveryScope,async db=>{
   assert.equal((await db.query("UPDATE app.website_capture_calls SET checkpoint='{\"phase\":\"creating\"}' WHERE job_id=$1",[original.id])).rowCount,0);
  });
 }finally{store.close();}
});

test('completed capture restores missing Cloud screenshots without another crawl or AI submission',async()=>{
 await admin.query('UPDATE app.account_entitlements SET max_active_businesses=100 WHERE organization_id=$1',[org.id]);
 brand=await workspaces.createBrand(alice,org.id,{name:'Cloud screenshot recovery',website:'https://example.org/'},randomUUID());
 const {maxunJournal}=await import('../../dist/maxun-journal.js'),{MaxunClient}=await import('../../dist/maxun-client.js'),{MaxunWorkflow}=await import('../../dist/maxun-workflow.js'),{MaxunIntake}=await import('../../dist/maxun-intake.js'),{IntakeJobs:Handler}=await import('../../dist/intake-jobs.js');
 const sharp=(await import('sharp')).default,{digest}=await import('../../dist/object-store.js');
 const original=await submit('website.extract'),robotId=randomUUID(),runId=randomUUID(),checkpoint={phase:'polling',robotId,runId};
 await maxunJournal(jobs,scope(original)).replace(null,checkpoint);
 await admin.query("UPDATE app.jobs SET status='succeeded' WHERE id=$1",[original.id]);
 assert.equal((await intake.read(alice,brand.id)).jobs.find(j=>j.id===original.id).can_recover,false);
 await assert.rejects(intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id},randomUUID()),/no verifiable/);
 await admin.query("UPDATE app.intake_requests SET result=$2 WHERE job_id=$1",[original.id,{visualErrors:[{code:'MAXUN_SCREENSHOT_REFERENCE_INVALID'}]}]);
 assert.equal((await intake.read(alice,brand.id)).jobs.find(j=>j.id===original.id).can_recover,true);
 await assert.rejects(intake.submit(bob,brand.id,{kind:'website.extract',recoverJobId:original.id},randomUUID()),/not found/i);
 await assert.rejects(intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id,autoAnalyze:true},randomUUID()),/does not start paid AI/);
 const recovery=await intake.submit(alice,brand.id,{kind:'website.extract',recoverJobId:original.id},randomUUID()),store=new ObjectStore(config.storage),j=new AssetJobs(worker,store,null),calls=[];
 const url=`https://media.example.org/${runId}/Crawl - 0 - Full Page`,bytes=await sharp({create:{width:600,height:800,channels:3,background:'#abc'}}).jpeg().toBuffer();
 const client=new MaxunClient('fixture',async(u,o)=>{calls.push(o.method);assert.equal(o.method,'GET');return Response.json({success:true,data:{id:runId,robotId,status:'success',data:{crawlData:[{metadata:{url:'https://example.org/'},text:'Recovered visual evidence',screenshotFullpage:url}]},screenshots:[{data:url,mimeType:'image/png'}]}});});
 try{
 const handler=new Handler(j,new BrandAnalyzer(),new MaxunIntake(new MaxunWorkflow(client),async(media,key,run)=>{assert.equal(run,runId);assert.equal(key,url);return {bytes,sha256:digest(bytes),width:600,height:800,kind:'fullpage'};}));
 const outcome=await handler.run(scope(recovery));assert.equal(outcome,'succeeded',JSON.stringify({error_code:(await row(recovery)).error_code}));assert.deepEqual(calls,['GET']);
 assert.equal((await row(original)).status,'succeeded');
 const result=(await admin.query('SELECT result FROM app.intake_requests WHERE job_id=$1',[recovery.id])).rows[0].result;assert.deepEqual(result.visualErrors,[]);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.website_visuals WHERE job_id=$1',[recovery.id])).rows[0].n,1);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.intake_dependencies WHERE capture_job_id=$1',[recovery.id])).rows[0].n,0);
 }finally{store.close();}
});

test('GPT-only website research persists cited notes, shares budget and survives replay without duplicate spend (MOCK provider)',async(t)=>{
 const {OpenAIWebsiteResearch,RESEARCH_RESERVATION_MICROS}=await import('../../dist/openai-website-research.js');
 const {IntakeJobs:ResearchJobs}=await import('../../dist/intake-jobs.js');
 const business=await workspaces.createBrand(alice,org.id,{name:'GPT research fixture',website:'https://example.org/'},randomUUID());
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',100000000,1,1,'LOCAL TEST ONLY',true)",[org.id,business.id]);
 const submitted=await intake.submit(alice,business.id,{kind:'website.extract',autoAnalyze:true},randomUUID());
 const scoped={organizationId:org.id,brandId:business.id,jobId:submitted.id};
 let calls=0;const first='Acme makes scheduling tools for dental practices. Source',second='The tools include appointment reminders. Source',text=first+'\n\n'+second;
 const sdk=new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(_url,init)=>{calls++;const request=JSON.parse(init.body);assert.equal(request.tools[0].type,'web_search');return Response.json({id:'resp_research_fixture',object:'response',status:'completed',output:[{id:'ws_fixture',type:'web_search_call',status:'completed',action:{type:'search',query:'example.org'}},{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[{type:'url_citation',url:'https://example.org/about',title:'About',start_index:first.indexOf('Source'),end_index:first.length},{type:'url_citation',url:'https://example.org/products',title:'Products',start_index:first.length+2+second.indexOf('Source'),end_index:text.length}]}]}],usage:{input_tokens:100,output_tokens:80,total_tokens:180}});}});
 const {WebsitePhotos}=await import('../../dist/website-photos.js');
 const {default:sharp}=await import('sharp');
 const store=new ObjectStore(config.storage),jobs=new AssetJobs(worker,store,null);t.after(()=>store.close());
 const photos=await Promise.all(['#ab2233','#2266cc','#44aa66'].map(background=>sharp({create:{width:640,height:480,channels:3,background}}).png().toBuffer()));
 const photoProvider=new WebsitePhotos({fetch:async(url)=>({status:url.pathname==='/robots.txt'?404:200,headers:{'content-type':url.pathname.endsWith('.png')?'image/png':'text/html'},bytes:url.pathname.endsWith('.png')?photos[url.pathname==='/a.png'?0:url.pathname==='/b.png'?1:2]:Buffer.from(url.pathname==='/products'?'<img src="/a.png"><img src="/c.png">':'<img src="/a.png"><img src="/b.png">')})});
 const provider=new OpenAIWebsiteResearch(undefined,sdk,photoProvider),handler=new ResearchJobs(jobs,new BrandAnalyzer(),provider);
 assert.equal(await handler.run(scoped),'succeeded');assert.equal(calls,1);
 assert.equal(await handler.run(scoped),'finished');assert.equal(calls,1);
 // Recovery after persistence but before application also reads the saved result.
 assert.equal((await provider.capture(jobs,scoped,'https://example.org/')).pages.length,2);assert.equal(calls,1);
 const saved=(await intake.read(alice,business.id)).jobs.find(j=>j.id===submitted.id);
 assert.equal(saved.result.provider,'openai');assert.equal(saved.result.coverage,'ai_web_research');assert.equal(saved.result.screenshotsAvailable,false);
 assert.equal(saved.result.newSources,2);
 const service=new Intake(businesses,store),state=await service.read(alice,business.id);
 assert.equal(state.visuals.length,3);assert.ok(state.visuals.every(v=>v.viewport==='photo'&&!('object_key' in v)));
 const signed=await service.visual(alice,business.id,state.visuals[0].id),download=await fetch(signed.url);
 assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/jpeg');
 assert.equal((await sharp(Buffer.from(await download.arrayBuffer())).metadata()).width,640);
 await assert.rejects(service.visual(bob,business.id,state.visuals[0].id),/not found/i);

 const notes=(await admin.query('SELECT c.text FROM app.brand_chunks c JOIN app.brand_sources s ON s.id=c.source_id WHERE s.brand_id=$1',[business.id])).rows;assert.equal(notes.length,2);assert.ok(notes.some(n=>n.text.includes('appointment reminders')));
 const ledger=(await admin.query('SELECT * FROM app.analysis_calls WHERE job_id=$1',[submitted.id])).rows[0];assert.equal(Number(ledger.reserved_micros),RESEARCH_RESERVATION_MICROS);
 await assert.rejects(provider.capture(jobs,{...scoped,brandId:brand.id},'https://example.org/'),/JOB_SCOPE_DENIED/);
 const child=(await intake.read(alice,business.id)).jobs.find(j=>j.kind==='brand.analyze');
 const model=analyzer(async(_url,init)=>response(output(init)));
 assert.equal(await new ResearchJobs(jobs,model,provider).run({...scoped,jobId:child.id}),'succeeded');
 assert.ok((await brain.read(alice,org.id,business.id)).findings.some(f=>f.field==='offering'&&f.status==='unreviewed'));
});

test('monthly budget shares all provider ledgers, serializes concurrent spend and never refunds ambiguous calls',async()=>{
 const account=await workspaces.create(alice,{name:'Monthly allowance fixture'});
 const b=await workspaces.createBrand(alice,account.id,{name:'Monthly brand'},randomUUID());
 const otherBrand=await workspaces.createBrand(alice,account.id,{name:'Second monthly brand'},randomUUID());
 await admin.query('INSERT INTO app.generation_plans(organization_id,monthly_price_usd) VALUES($1,500)',[account.id]);
 async function reservation(table,cost,{id=randomUUID(),conflict=false,brandId=b.id}={}){
  await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'website.extract','succeeded') ON CONFLICT DO NOTHING",[id,account.id,brandId,alice]);
  const columns=table==='analysis_calls'?',review_revision':table==='creative_calls'||table==='planning_calls'?',step':'';
  const extra=table==='analysis_calls'?',1':table==='creative_calls'?",'image'":table==='planning_calls'?',1':'';
  const common=table==='video_reservations'?'':",input_sha256,status";
  const values=table==='video_reservations'?'':",'fixture','submitted'";
  await admin.query(`INSERT INTO app.${table}(job_id,organization_id,brand_id,model,reserved_micros${columns}${common}) VALUES($1,$2,$3,'MOCK',$4${extra}${values})${conflict?' ON CONFLICT DO NOTHING':''}`,[id,account.id,brandId,cost]);return id;
 }
 const usage=async()=>Number((await admin.query("SELECT reserved_micros FROM app.monthly_generation_usage WHERE organization_id=$1 AND month_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date",[account.id])).rows[0].reserved_micros);
 for(const table of ['analysis_calls','creative_calls','planning_calls','video_reservations'])await reservation(table,20000000,{brandId:table==='video_reservations'?otherBrand.id:b.id});
 assert.equal(await usage(),80000000);
 await admin.query("INSERT INTO app.monthly_generation_usage VALUES($1,(date_trunc('month',now() AT TIME ZONE 'UTC')-interval '1 month')::date,200000000)",[account.id]);
 const outcomes=await Promise.allSettled([reservation('creative_calls',15000000),reservation('planning_calls',15000000)]);
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.equal(outcomes.filter(o=>o.status==='rejected'&&o.reason.message==='MONTHLY_GENERATION_BUDGET_EXHAUSTED').length,1);assert.equal(await usage(),95000000);
 const replay=await reservation('analysis_calls',5000000);await reservation('analysis_calls',5000000,{id:replay,conflict:true});assert.equal(await usage(),100000000);
 await admin.query("UPDATE app.analysis_calls SET status='unknown' WHERE job_id=$1",[replay]);await assert.rejects(reservation('video_reservations',1),/MONTHLY_GENERATION_BUDGET_EXHAUSTED/);assert.equal(await usage(),100000000);
 assert.equal((await app.query('SELECT * FROM app.monthly_generation_usage')).rowCount,0);await assert.rejects(worker.query('SELECT * FROM app.monthly_generation_usage'),/permission denied/);
 for(const pool of [app,worker])await assert.rejects(pool.query('UPDATE app.generation_plans SET monthly_price_usd=1000'),/permission denied/);
 await admin.query('UPDATE app.generation_plans SET monthly_price_usd=800 WHERE organization_id=$1',[account.id]);await reservation('video_reservations',60000000);await assert.rejects(reservation('analysis_calls',1),/MONTHLY_GENERATION_BUDGET_EXHAUSTED/);
 await admin.query('UPDATE app.generation_plans SET monthly_price_usd=1000 WHERE organization_id=$1',[account.id]);await reservation('planning_calls',40000000);await assert.rejects(reservation('creative_calls',1),/MONTHLY_GENERATION_BUDGET_EXHAUSTED/);
 await admin.query('UPDATE app.generation_plans SET enabled=false WHERE organization_id=$1',[account.id]);
 // Explicit fixture: even an empty counter must not bypass a disabled plan.
 await admin.query('UPDATE app.monthly_generation_usage SET reserved_micros=0 WHERE organization_id=$1',[account.id]);await assert.rejects(reservation('analysis_calls',1),/MONTHLY_GENERATION_BUDGET_EXHAUSTED/);
 await admin.query("UPDATE app.brands SET website='https://example.org/' WHERE id=$1",[b.id]);
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',1000000000,1,1,'LOCAL TEST ONLY',true)",[account.id,b.id]);
 const job=await intake.submit(alice,b.id,{kind:'website.extract'},randomUUID());
 const {OpenAIWebsiteResearch}=await import('../../dist/openai-website-research.js');const {IntakeJobs:ResearchHandler}=await import('../../dist/intake-jobs.js');
 let externalCalls=0;const sdk=new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async()=>{externalCalls++;throw new Error('Must not spend');}});
 assert.equal(await new ResearchHandler(jobs,new BrandAnalyzer(),new OpenAIWebsiteResearch(undefined,sdk)).run({organizationId:account.id,brandId:b.id,jobId:job.id}),'rejected');
 assert.equal((await row(job)).error_code,'MONTHLY_GENERATION_BUDGET_EXHAUSTED');assert.equal(externalCalls,0);
});


test('monthly budget shares a tenant-scoped rounded credit balance without exposing provider costs',async()=>{
 const account=await workspaces.create(alice,{name:'Credit balance account'});
 assert.deepEqual(await workspaces.generationUsage(alice,account.id),{configured:false});
 await admin.query('INSERT INTO app.generation_plans VALUES($1,800,true)',[account.id]);
 await admin.query("INSERT INTO app.monthly_generation_usage VALUES($1,date_trunc('month',now() AT TIME ZONE 'UTC')::date,10001)",[account.id]);
 const balance=await workspaces.generationUsage(alice,account.id);assert.equal(balance.total_credits,16000);assert.equal(balance.used_credits,2);assert.equal(balance.remaining_credits,15998);assert.equal(balance.enabled,true);assert.ok(new Date(balance.resets_at)>new Date());assert.ok(!('reserved_micros' in balance));
 await assert.rejects(workspaces.generationUsage(bob,account.id),/Account not found/);
 await admin.query('UPDATE app.generation_plans SET enabled=false WHERE organization_id=$1',[account.id]);assert.equal((await workspaces.generationUsage(alice,account.id)).remaining_credits,0);
 await admin.query('UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[account.id,alice]);await assert.rejects(workspaces.generationUsage(alice,account.id),/Account not found/);
});

test('citation-free search continues through direct website evidence to brand analysis (MOCK provider)',async()=>{
 const {IntakeJobs:DirectIntakeJobs}=await import('../../dist/intake-jobs.js');
 const {OpenAIWebsiteResearch}=await import('../../dist/openai-website-research.js');
 const {WebsiteText}=await import('../../dist/website-text.js');
 const b=await workspaces.createBrand(alice,org.id,{name:'Direct website recovery',website:'https://example.org/'},randomUUID());
 await admin.query("INSERT INTO app.analysis_grants(organization_id,brand_id,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by,enabled) VALUES($1,$2,'MOCK-model',now()+interval '1 hour',100000000,1,1,'LOCAL TEST ONLY',true)",[org.id,b.id]);
 const submitted=await intake.submit(alice,b.id,{kind:'website.extract',autoAnalyze:true},randomUUID()),scope={organizationId:org.id,brandId:b.id,jobId:submitted.id};let calls=0;
 const sdk={responses:{create:async()=>{calls++;return {id:'resp_direct_fixture',status:'completed',output:[{type:'web_search_call',status:'completed'}],usage:{input_tokens:100,output_tokens:5}};}}};
 const direct=new WebsiteText({fetch:async u=>({status:u.pathname==='/robots.txt'?404:200,headers:{'content-type':'text/html'},bytes:Buffer.from('<h1>Acme makes scheduling tools for dental practices in Mumbai.</h1><p>Our appointment scheduling service helps dental practice teams manage patient bookings and appointment reminders through a shared calendar.</p>')})});
 const provider=new OpenAIWebsiteResearch(undefined,sdk,undefined,direct),handler=new DirectIntakeJobs(jobs,new BrandAnalyzer(),provider);
 assert.equal(await handler.run(scope),'succeeded');assert.equal(calls,1);
 assert.equal((await provider.capture(jobs,scope,'https://example.org/')).pages[0].coverage,'server_html_only');assert.equal(calls,1);
 const sources=await admin.query('SELECT coverage FROM app.brand_sources WHERE brand_id=$1',[b.id]);assert.equal(sources.rows[0].coverage.type,'server_html_only');
 const child=(await intake.read(alice,b.id)).jobs.find(j=>j.kind==='brand.analyze');
 assert.equal(await new DirectIntakeJobs(jobs,analyzer(async(_url,init)=>response(output(init))),provider).run({...scope,jobId:child.id}),'succeeded');
 await assert.rejects(provider.capture(jobs,{...scope,brandId:brand.id},'https://example.org/'),/JOB_SCOPE_DENIED/);
});

for(const withScreenshot of [true,false])test(`self-hosted rendered text and photographs persist with scoped provenance (${withScreenshot?'with screenshot':'photos only'}; MOCK browser output; real database/storage)`,async()=>{
 const {normalizeRenderedCapture}=await import('../../dist/website-renderer.js');
 const {WebsiteRenderBroker}=await import('../../dist/website-render-broker.js');
 const {IntakeJobs:ProductionIntakeJobs}=await import('../../dist/intake-jobs.js');
 const sharp=(await import('sharp')).default;
 const {digest}=await import('../../dist/object-store.js');
 const business=await workspaces.createBrand(alice,org.id,{name:'Rendered site fixture',website:'https://example.com/'},randomUUID());
 const submitted=await intake.submit(alice,business.id,{kind:'website.extract'},randomUUID());
 const scoped={organizationId:org.id,brandId:business.id,jobId:submitted.id};
 const persistedStore=config.storage?new ObjectStore(config.storage):null,objects=new Map();
 const store={persist:async(key,bytes,type,sha)=>{assert.equal(digest(bytes),sha);objects.set(key,bytes);if(persistedStore)await persistedStore.persist(key,bytes,type,sha);},read:async(key,max)=>persistedStore?persistedStore.read(key,max):objects.get(key)};
 const screenshot=await sharp({create:{width:1440,height:1000,channels:3,background:'#abcdef'}}).jpeg().toBuffer();
 const photo=await sharp({create:{width:500,height:350,channels:3,background:'#123456'}}).png().toBuffer();
 const broker=new WebsiteRenderBroker('https://example.com/');broker.documents.add('https://example.com/');broker.images.set('https://example.com/photo.png',photo);
 const captured=await normalizeRenderedCapture({version:'website-renderer-v1',pages:[{url:'https://example.com/',title:'Example',text:'Example creates scheduling tools for local business owners. '.repeat(6),links:[],images:[{url:'https://example.com/photo.png',label:'Office photograph'}],...(withScreenshot?{screenshot:screenshot.toString('base64')}:{})}]},'https://example.com/',broker);
 const isolatedJobs=new AssetJobs(worker,store,null),pipeline=new ProductionIntakeJobs(isolatedJobs,new BrandAnalyzer(),{capture:async()=>captured});
 assert.equal(await pipeline.run(scoped),'succeeded');
 const sources=(await admin.query('SELECT * FROM app.brand_sources WHERE organization_id=$1 AND brand_id=$2',[org.id,business.id])).rows;assert.equal(sources.length,1);assert.equal(sources[0].parser_version,'website-renderer-v1');
 const visuals=(await admin.query('SELECT * FROM app.website_visuals WHERE source_id=$1 ORDER BY viewport',[sources[0].id])).rows;assert.equal(visuals.length,withScreenshot?2:1);assert.ok(visuals.some(v=>v.observations.kind==='website_photo'&&v.observations.source_url==='https://example.com/photo.png'));assert.ok(visuals.every(v=>v.object_key.startsWith(`evidence/${org.id}/${business.id}/${submitted.id}/`)));assert.equal(objects.size,withScreenshot?2:1);
 const result=(await admin.query('SELECT result FROM app.intake_requests WHERE job_id=$1',[submitted.id])).rows[0].result;
 assert.equal(result.screenshotsAvailable,withScreenshot);assert.equal(result.coverage,withScreenshot?'rendered_provider':'partial_visual');assert.equal(result.photosAvailable,1);
 await assert.rejects(intake.read(bob,business.id));
 assert.equal(await pipeline.run(scoped),'finished');assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.website_visuals WHERE source_id=$1',[sources[0].id])).rows[0].n,withScreenshot?2:1);
});
