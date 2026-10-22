import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import OpenAI from "openai";
import { Worker, NativeConnection } from "@temporalio/worker";
import { Connection, Client } from "@temporalio/client";
import { Context } from "@temporalio/activity";
import { fileURLToPath } from "node:url";
import { TenantDatabase } from "../../dist/database.js";
import { Workspaces } from "../../dist/workspaces.js";
import { Businesses } from "../../dist/businesses.js";
import { BrandBrain } from "../../dist/brand-brain.js";
import { Canvas } from "../../dist/canvas.js";
import { ObjectStore, digest } from "../../dist/object-store.js";
import { AssetJobs } from "../../dist/jobs.js";
import { SkillRuntime } from "../../dist/skill-runtime.js";
import { CreativeProvider } from "../../dist/creative-provider.js";
import { CreativeJobs } from "../../dist/creative-jobs.js";
const config = JSON.parse(process.env.DESVIO_TEST_CONFIG),
  admin = new Pool({ connectionString: process.env.DESVIO_TEST_ADMIN_URL }),
  app = new Pool({ connectionString: config.appDatabaseUrl }),
  worker = new Pool({ connectionString: config.jobs.workerDatabaseUrl });
const database = new TenantDatabase(app),
  workspaces = new Workspaces(database),
  businesses = new Businesses(database, workspaces),
  brain = new BrandBrain(database),
  store = new ObjectStore(config.storage),
  canvas = new Canvas(businesses, store),
  jobs = new AssetJobs(worker, store, null),
  skills = new SkillRuntime(process.env.SKILL_RUNTIME_IMAGE);
const alice = randomUUID(),
  bob = randomUUID(),
  editor = randomUUID(),
  viewer = randomUUID();
let org,
  brand,
  thread,
  project,
  version,
  transport,
  planCalls = 0,
  imageCalls = 0;
const png = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: "#c0ffee" },
})
  .png()
  .toBuffer();
const scope = (j) => ({
  organizationId: org.id,
  brandId: brand.id,
  jobId: j.id,
});
const row = async (j) =>
  (
    await admin.query("SELECT status,error_code FROM app.jobs WHERE id=$1", [
      j.id,
    ])
  ).rows[0];
const request = (prompt = "Create an image", parent_version_id = null) => ({
  prompt,
  format: "static",
  channel: "linkedin",
  size: "1024x1024",
  parent_version_id,
});
const brief = (id) => ({
  headline: "A calmer schedule",
  body: "",
  cta: "Discover",
  caption: "TEST FIXTURE: Dental scheduling tools",
  image_prompt: "TEST FIXTURE: A calm office with space for editable overlays",
  palette: ["#ffffff", "#112233"],
  fact_ids: [id],
  warnings: ["TEST FIXTURE: human review required"],
});
function response(value) {
  return Response.json({
    object: "response",
    id: "resp_fixture",
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify(value), annotations: [] },
        ],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
  });
}
async function standard(url, init) {
  const path = new URL(url).pathname;
  if (path === "/v1/responses") {
    planCalls++;
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.ok(body.tools.every((t) => t.name === "read_file"));
    const message = body.input.find(
      (m) =>
        m.role === "user" &&
        m.content.startsWith("UNTRUSTED BUSINESS DATA AND REQUEST:\n"),
    );
    const value = JSON.parse(
      message.content.slice(message.content.indexOf("\n") + 1),
    );
    assert.equal(
      value.brand.facts.find((f) => f.field === "brand_name").value,
      "Acme Dental",
    );
    assert.equal(value.brand.facts.find(f=>f.field==='visual_direction_composition').value,'Use generous spacing and restrained typography.');
    assert.ok(body.input.some((m) => m.content?.includes("image")));
    assert.ok(!JSON.stringify(body).includes(config.storage.secretAccessKey));
    return response(
      brief(value.brand.facts.find((f) => f.field === "offering").id),
    );
  }
  imageCalls++;
  if (path === "/v1/images/edits") {
    assert.equal(
      digest(Buffer.from(await init.body.get("image").arrayBuffer())),
      digest(
        await store.read(
          (
            await admin.query(
              "SELECT object_key FROM app.creative_media WHERE organization_id=$1 AND brand_id=$2 AND id=$3",
              [org.id, brand.id, version.media_id],
            )
          ).rows[0].object_key,
        ),
      ),
    );
  } else assert.equal(path, "/v1/images/generations");
  return Response.json({
    created: 1,
    data: [{ b64_json: png.toString("base64") }],
    usage: { input_tokens: 50, output_tokens: 100, total_tokens: 150 },
  });
}
const provider = new CreativeProvider(
  undefined,
  new OpenAI({
    apiKey: "fixture-only",
    maxRetries: 0,
    fetch: async (url, init) =>
      String(url).startsWith("data:")
        ? fetch(url, init)
        : (transport ?? standard)(url, init),
  }),
);
const handler = new CreativeJobs(jobs, skills, provider);
const submit = (p = "Create an image", parent = null) =>
  canvas.submit(alice, brand.id, thread.id, request(p, parent), randomUUID());
async function grant(budget = 10000000) {
  await admin.query(
    "INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',$3,0.01,0.02,100000,'LOCAL TEST ONLY',true) ON CONFLICT(organization_id,brand_id) DO UPDATE SET budget_micros=$3,enabled=true",
    [org.id, brand.id, budget],
  );
}
before(async () => {
  for (const id of [alice, bob, editor, viewer])
    await admin.query(
      'INSERT INTO auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$1::text,$2,true)',
      [id, `${id}@example.test`],
    );
  org = await workspaces.create(alice, { name: "Creative account" });
  brand = await workspaces.createBrand(
    alice,
    org.id,
    { name: "Acme Dental" },
    randomUUID(),
  );
  for (const [id, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ])
    await admin.query(
      "INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,$3)",
      [org.id, id, role],
    );
  for (const [field, value] of [
    ["brand_name", "Acme Dental"],
    ["offering", "Scheduling tools for dental practices"],
    ["audience", "Dental practices"],
  ])
    await brain.manual(alice, org.id, brand.id, { field, value }, randomUUID());
  let state = await brain.read(alice, org.id, brand.id);
  for (const f of state.findings)
    await brain.review(alice, org.id, brand.id, f.id, {
      decision: "correct",
      revision: f.revision,
    });
  // Explicit visual-analysis fixture; review/approval and the downstream skill broker are real.
  const visualJob=randomUUID(),visualSuggestion={category:'composition',observation:'TEST FIXTURE: open spacing',creative_direction:'Use generous spacing and restrained typography.',image_ids:['fixture:overview']};
  await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'brand.analyze','succeeded')",[visualJob,org.id,brand.id,alice]);
  await admin.query("INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,result) VALUES($1,$2,$3,$4,'explicit-fixture',$5)",[visualJob,org.id,brand.id,randomUUID(),JSON.stringify({visual_guidance:[visualSuggestion],visual_manifest:[{id:'fixture:overview',website_url:'https://example.org/',source_sha256:'a'.repeat(64)}]})]);
  const direction=(await brain.read(alice,org.id,brand.id)).visuals.directions[0];
  await brain.reviewVisual(alice,org.id,brand.id,{analysis_job_id:visualJob,index:0,evidence_sha256:direction.evidence_sha256,revision:0,decision:'correct'});
  state = await brain.read(alice, org.id, brand.id);
  await brain.approve(alice, org.id, brand.id, { revision: state.revision });
  thread = await canvas.createThread(
    alice,
    brand.id,
    { title: "Campaign" },
    randomUUID(),
  );
});
after(async () => {
  store.close();
  await Promise.all([admin.end(), app.end(), worker.end()]);
});

test("actual isolated Deep Agents loads pinned owner skills; file reads cannot escape the per-run virtual brand mount", async () => {
  const input = {
    brand: {
      id: randomUUID(),
      sha256: "a".repeat(64),
      facts: [{ id: "fact-a", field: "offering", value: "BRAND_A_ONLY" }],
    },
    prompt: "Create a static ad",
    format: "ad",
    channel: "linkedin",
    parent: null,
  };
  let calls = 0;
  const result = await skills.plan(input, async (req) => {
    calls++;
    assert.ok(req.tools.every((t) => t.function.name === "read_file"));
    assert.ok(!JSON.stringify(req.messages).includes("BRAND_B_ONLY"));
    if (calls === 1) {
      assert.ok(req.messages.some((m) => m.content.includes("BRAND_A_ONLY")));
      return {
        content: "",
        tool_calls: [
          {
            id: "read-1",
            name: "read_file",
            args: { file_path: "/etc/passwd" },
          },
        ],
      };
    }
    const denied = req.messages.find((m) => m.role === "tool");
    assert.ok(denied);
    assert.match(denied.content, /permission|denied/i);
    assert.ok(!denied.content.includes("root:"));
    return { content: JSON.stringify(brief("fact-a")), tool_calls: [] };
  });
  assert.equal(result.skills.length, 4);
  assert.equal(result.helpers_executed, false);
  assert.equal(calls, 2);
  await assert.rejects(
    skills.plan(
      {
        ...input,
        brand: {
          ...input.brand,
          facts: [{ id: "fact-b", field: "offering", value: "BRAND_B_ONLY" }],
        },
      },
      async (req) => {
        assert.ok(!JSON.stringify(req.messages).includes("BRAND_A_ONLY"));
        return {
          content: "",
          tool_calls: [
            { id: "bad", name: "execute", args: { command: "echo unsafe" } },
          ],
        };
      },
    ),
    /SKILL_TOOL_DENIED/,
  );
});

test("Canvas conversations are scoped/idempotent; unapproved brands and viewers cannot queue generation", async () => {
  const k = randomUUID(),
    one = await canvas.createThread(
      alice,
      brand.id,
      { title: "One request" },
      k,
    );
  assert.deepEqual(
    await canvas.createThread(alice, brand.id, { title: "One request" }, k),
    one,
  );
  await assert.rejects(
    canvas.createThread(alice, brand.id, { title: "Changed" }, k),
    /different conversation/,
  );
  await assert.rejects(canvas.thread(bob, brand.id, thread.id), /not found/i);
  await assert.rejects(
    canvas.submit(viewer, brand.id, thread.id, request(), randomUUID()),
    /read-only|cannot/i,
  );
  const other = await workspaces.createBrand(
      alice,
      org.id,
      { name: "Unapproved" },
      randomUUID(),
    ),
    t = await canvas.createThread(
      alice,
      other.id,
      { title: "No profile" },
      randomUUID(),
    );
  await assert.rejects(
    canvas.submit(alice, other.id, t.id, request(), randomUUID()),
    /Confirm your brand/,
  );
  const j = await submit();
  assert.equal(await handler.run(scope(j)), "rejected");
  assert.equal((await row(j)).error_code, "CREATIVE_STAGING_APPROVAL_REQUIRED");
  assert.equal(planCalls + imageCalls, 0);
});

test("real Temporal workflow executes isolated owner skills, mocked OpenAI generation and actual private persisted creative", async () => {
  await grant();
  const k = randomUUID(),
    j = await canvas.submit(alice, brand.id, thread.id, request(), k);
  assert.deepEqual(
    await canvas.submit(alice, brand.id, thread.id, request(), k),
    j,
  );
  const connection = await NativeConnection.connect({
      address: config.jobs.address,
    }),
    clientConnection = await Connection.connect({
      address: config.jobs.address,
    }),
    queue = "creative-" + randomUUID();
  const temporal = await Worker.create({
    connection,
    namespace: config.jobs.namespace,
    taskQueue: queue,
    workflowsPath: fileURLToPath(
      new URL("../../dist/asset-workflow.js", import.meta.url),
    ),
    activities: {
      generateCreative: async (s) => {
        const timer = setInterval(() => Context.current().heartbeat(), 1000);
        try {
          return await handler.run(s);
        } finally {
          clearInterval(timer);
        }
      },
      failCreative: (s) => handler.fail(s),
    },
  });
  try {
    const client = new Client({
      connection: clientConnection,
      namespace: config.jobs.namespace,
    });
    const result = await temporal.runUntil(() =>
      client.workflow.execute("generateCreativeWorkflow", {
        workflowId: "creative-test-" + j.id,
        taskQueue: queue,
        args: [scope(j)],
      }),
    );
    assert.equal(result, "succeeded", JSON.stringify(await row(j)));
  } finally {
    await connection.close();
    await clientConnection.close();
  }
  assert.equal(planCalls, 1);
  assert.equal(imageCalls, 1);
  const state = await canvas.thread(alice, brand.id, thread.id);
  assert.ok(state.messages.some((m) => m.role === "assistant"));
  project = state.projects.find((p) => p.latest_version_id);
  version = (await canvas.project(alice, brand.id, project.id)).versions[0];
  assert.equal(version.status, "draft");
  assert.equal(version.skill_manifest.skills.length, 3);
  assert.ok(version.skill_manifest.reserved_cost_micros >= 100000);
  const signed = await canvas.media(alice, brand.id, version.media_id);
  assert.equal((await fetch(signed.url)).status, 200);
  await assert.rejects(
    canvas.media(bob, brand.id, version.media_id),
    /not found/i,
  );
  assert.equal(await handler.run(scope(j)), "finished");
  assert.equal(planCalls, 1);
  assert.equal(imageCalls, 1);
  await assert.rejects(
    jobs.transaction({ ...scope(j), brandId: randomUUID() }, (db) =>
      db.query("SELECT * FROM app.creative_versions"),
    ),
    /JOB_SCOPE_DENIED/,
  );
  await assert.rejects(
    app.query("UPDATE app.creative_grants SET enabled=true"),
    /permission denied/,
  );
  await assert.rejects(
    worker.query("UPDATE app.creative_versions SET status='approved'"),
    /permission denied/,
  );
});

test("manual layer edits persist as new versions; review approves the exact current version and preserves prior history", async () => {
  const design = structuredClone(version.design);
  design.layers[0].text = "Owner headline";
  design.layers[0].fontFamily = "Georgia";
  design.layers[0].x = 80;
  design.layers.push({
    ...design.layers[0],
    id: "custom",
    text: "Custom approved overlay",
    y: 500,
  });
  const body = { parent_id: version.id, design, caption: "Owner caption" },
    saved = await canvas.save(editor, brand.id, project.id, body);
  assert.deepEqual(
    await canvas.save(editor, brand.id, project.id, body),
    saved,
  );
  await assert.rejects(
    canvas.save(editor, brand.id, project.id, { ...body, caption: "Stale" }),
    /changed/,
  );
  await assert.rejects(
    canvas.save(viewer, brand.id, project.id, { ...body, parent_id: saved.id }),
    /read-only|cannot/i,
  );
  const projectState = await canvas.project(alice, brand.id, project.id);
  assert.equal(
    projectState.versions.find((v) => v.id === saved.id).design.layers[0].text,
    "Owner headline",
  );
  assert.equal(
    projectState.versions.find((v) => v.id === version.id).design.layers[0]
      .text,
    "A calmer schedule",
  );
  await canvas.review(editor, brand.id, saved.id, {
    decision: "in_review",
    feedback: "Ready for review",
    revision: 1,
  });
  await assert.rejects(
    canvas.review(editor, brand.id, saved.id, {
      decision: "approved",
      feedback: "",
      revision: 2,
    }),
    /owner or admin/,
  );
  await canvas.review(alice, brand.id, saved.id, {
    decision: "approved",
    feedback: "Approved exact version",
    revision: 2,
  });
  await assert.rejects(
    canvas.review(alice, brand.id, saved.id, {
      decision: "approved",
      feedback: "",
      revision: 2,
    }),
    /latest saved/,
  );
  version = (await canvas.project(alice, brand.id, project.id)).versions.find(
    (v) => v.id === saved.id,
  );
  assert.equal(version.status, "approved");
  await assert.rejects(
    app.query("UPDATE app.creative_versions SET caption=$1 WHERE id=$2", [
      "tampered",
      saved.id,
    ]),
    /permission denied/,
  );
});

test("natural-language image edit sends persisted prior pixels and creates an unapproved child version", async () => {
  const prior = version,
    j = await submit("Make the background sage", prior.id);
  assert.equal(
    await handler.run(scope(j)),
    "succeeded",
    JSON.stringify(await row(j)),
  );
  assert.equal(imageCalls, 2);
  const p = await canvas.project(alice, brand.id, project.id);
  version = p.versions.find((v) => v.id === p.project.latest_version_id);
  assert.equal(version.parent_id, prior.id);
  assert.equal(version.design.layers[0].fontFamily, "Georgia");
  assert.equal(version.design.layers[0].x, 80);
  assert.equal(
    version.design.layers.find((l) => l.id === "custom").text,
    "Custom approved overlay",
  );
  assert.equal(version.status, "draft");
  assert.equal(p.versions.find((v) => v.id === prior.id).status, "approved");
});

test("unknown paid outcomes and worker resumption do not resubmit or bypass the business budget", async () => {
  const before = imageCalls;
  transport = async (url, init) => {
    if (new URL(url).pathname.startsWith("/v1/images/")) {
      imageCalls++;
      throw new TypeError("MOCK lost provider response");
    }
    return standard(url, init);
  };
  const j = await submit("Another variation");
  assert.equal(await handler.run(scope(j)), "unknown");
  assert.equal((await row(j)).error_code, "CREATIVE_SUBMISSION_UNKNOWN");
  assert.equal(imageCalls, before + 1);
  await admin.query("UPDATE app.jobs SET status='retrying' WHERE id=$1", [
    j.id,
  ]);
  assert.equal(await handler.run(scope(j)), "unknown");
  assert.equal(imageCalls, before + 1);
  await assert.rejects(submit(), /uncertain/);
  // Test-only operator reconciliation unlocks the following independent cases.
  await admin.query("UPDATE app.jobs SET status='rejected' WHERE id=$1", [
    j.id,
  ]);
  transport = undefined;
  await grant(1);
  const exhausted = await submit();
  const count = planCalls + imageCalls;
  assert.equal(await handler.run(scope(exhausted)), "rejected");
  assert.equal((await row(exhausted)).error_code, "CREATIVE_BUDGET_EXHAUSTED");
  assert.equal(planCalls + imageCalls, count);
  await grant();
});

test("cancellation and access loss prevent creative promotion; new user edits are not overwritten by an in-flight image", async () => {
  let pending;
  transport = async (url, init) => {
    const output = await standard(url, init);
    if (new URL(url).pathname.startsWith("/v1/images/"))
      await canvas.cancel(alice, brand.id, pending.id);
    return output;
  };
  pending = await submit("Canceled creation");
  assert.equal(await handler.run(scope(pending)), "canceled");
  assert.ok(
    !(await canvas.thread(alice, brand.id, thread.id)).messages.some(
      (m) => m.job_id === pending.id && m.role === "assistant",
    ),
  );
  transport = undefined;
  const revoked = await submit();
  await admin.query(
    "UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2",
    [org.id, alice],
  );
  const count = planCalls + imageCalls;
  assert.equal(await handler.run(scope(revoked)), "finished");
  assert.equal((await row(revoked)).status, "canceled");
  assert.equal(planCalls + imageCalls, count);
  await admin.query(
    "UPDATE app.memberships SET active=true WHERE organization_id=$1 AND user_id=$2",
    [org.id, alice],
  );
  const original = version;
  transport = async (url, init) => {
    const output = await standard(url, init);
    if (new URL(url).pathname.startsWith("/v1/images/"))
      await canvas.save(editor, brand.id, project.id, {
        parent_id: original.id,
        design: original.design,
        caption: "Edited while image ran",
      });
    return output;
  };
  const changed = await submit("Update image", version.id);
  assert.equal(await handler.run(scope(changed)), "rejected");
  assert.equal((await row(changed)).error_code, "CREATIVE_VERSION_CHANGED");
  transport = undefined;
});

// Slot workflows use real database roles, isolated skills and private storage.
// Only the provider transport is MOCK; no live creative-quality claim.
const {ContentPlan}=await import('../../dist/content-plan.js');
const {SlotCreatives}=await import('../../dist/slot-creatives.js');
const plans=new ContentPlan(businesses),slotCreatives=new SlotCreatives(plans,canvas);
async function plannedSlot(){
 const p=await plans.create(alice,brand.id,{title:'TEST FIXTURE plan',objective:'Explain the offering',starts_on:'2026-11-01',timezone:'UTC',slots:[{channel:'linkedin',planned_at:'2026-11-05T08:00:00Z',format:'static',brief:'Explain our scheduling tool',pillar:'Education',hook:'A calmer day',cta:'Learn more'}]},randomUUID());
 return (await plans.list(alice,brand.id,{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z',plan_id:p.id})).slots[0];
}
const decision=(s,d,feedback='')=>({revision:s.revision,creative_version_id:s.creative_version_id,creative_sha256:s.creative_sha256,decision:d,feedback});
let linkedSlot;
test('planned draft generation is atomic/idempotent, privately attaches the exact creative and records review history',async()=>{
 const s=await plannedSlot(),key=randomUUID(),body={revision:s.revision,feedback:'Keep it simple'};
 await assert.rejects(slotCreatives.generate(viewer,brand.id,s.id,body,key),/read-only|cannot/i);
 await assert.rejects(slotCreatives.detail(bob,brand.id,s.id),/not found/i);
 const results=await Promise.all([slotCreatives.generate(alice,brand.id,s.id,body,key),slotCreatives.generate(alice,brand.id,s.id,body,key)]);
 assert.equal(results[0].id,results[1].id);
 await assert.rejects(slotCreatives.generate(alice,brand.id,s.id,{...body,feedback:'Changed'},key),/another creative/);
 const count=imageCalls,j=results[0];
 const unrelated=await plannedSlot();
 await jobs.transaction(scope(j),async db=>{assert.equal((await db.query("UPDATE app.content_slots SET state='draft_ready' WHERE id=$1",[unrelated.id])).rowCount,0);});
 await assert.rejects(jobs.transaction(scope(j),db=>db.query("UPDATE app.content_slots SET state='approved' WHERE id=$1",[s.id])),e=>e.code==='42501');
 assert.equal(await handler.run(scope(j)),'succeeded',JSON.stringify(await row(j)));assert.equal(imageCalls,count+1);
 const detail=await slotCreatives.detail(alice,brand.id,s.id);linkedSlot=detail.slot;
 assert.equal(linkedSlot.state,'draft_ready');assert.equal(linkedSlot.approved_by,null);assert.equal(linkedSlot.revision,3);
 assert.equal(detail.generations[0].attachment_status,'attached');assert.equal(detail.generations[0].attached_version_id,linkedSlot.creative_version_id);
 assert.deepEqual(detail.events.map(e=>e.action),['created','generation_requested','creative_attached']);
 assert.equal(detail.events[2].creative_sha256,linkedSlot.creative_sha256);
 assert.equal((await fetch((await canvas.media(alice,brand.id,linkedSlot.media_id)).url)).status,200);
 assert.equal((await slotCreatives.generate(alice,brand.id,s.id,body,key)).id,j.id);
 await jobs.transaction(scope(j),async db=>{assert.deepEqual((await db.query('SELECT id FROM app.content_slots')).rows.map(r=>r.id),[s.id]);assert.equal((await db.query("UPDATE app.content_slots SET state='approved'")).rowCount,0);});
 await assert.rejects(jobs.transaction(scope(j),db=>db.query('UPDATE app.content_slots SET approved_by=$1',[alice])),e=>e.code==='42501');
});
test('review feedback reaches the actual skill input and image editing uses the linked prior pixels without retaining approval',async()=>{
 let s=await plans.review(editor,brand.id,linkedSlot.id,decision(linkedSlot,'pending_review'));
 s=await plans.review(alice,brand.id,s.id,decision(s,'changes_requested','Use a calmer visual'));
 let sawFeedback=false,sawEdit=false;
 version=(await canvas.project(alice,brand.id,linkedSlot.project_id)).versions.find(v=>v.id===s.creative_version_id);
 transport=async(url,init)=>{const path=new URL(url).pathname;if(path==='/v1/responses'){const payload=JSON.parse(init.body);sawFeedback=JSON.stringify(payload).includes('Use a calmer visual')&&JSON.stringify(payload).includes('Less clutter');}if(path==='/v1/images/edits')sawEdit=true;return standard(url,init);};
 try{
  const j=await slotCreatives.generate(editor,brand.id,s.id,{revision:s.revision,feedback:'Less clutter'},randomUUID());
  assert.equal(await handler.run(scope(j)),'succeeded',JSON.stringify(await row(j)));assert.ok(sawFeedback&&sawEdit);
 }finally{transport=undefined;}
 linkedSlot=(await slotCreatives.detail(alice,brand.id,s.id)).slot;assert.equal(linkedSlot.state,'draft_ready');assert.notEqual(linkedSlot.creative_version_id,s.creative_version_id);assert.equal(linkedSlot.approved_by,null);
 let approved=await plans.review(alice,brand.id,s.id,decision(linkedSlot,'pending_review'));approved=await plans.review(alice,brand.id,s.id,decision(approved,'approved'));
 const before=(await canvas.list(alice,brand.id)).threads.length;
 await assert.rejects(slotCreatives.generate(alice,brand.id,s.id,{revision:approved.revision},randomUUID()),/requires a new review/);
 assert.equal((await canvas.list(alice,brand.id)).threads.length,before);
 const j=await slotCreatives.generate(alice,brand.id,s.id,{revision:approved.revision,reset_approval:true},randomUUID());
 assert.equal((await slotCreatives.detail(alice,brand.id,s.id)).slot.approved_by,null);
 await canvas.cancel(alice,brand.id,j.id);await handler.run(scope(j));
});
test('newer plan edits or cancellation during generation preserve the resulting Canvas draft without attaching it',async()=>{
 for(const cancel of [false,true]){
  const original=await plannedSlot();let queued;
  transport=async(url,init)=>{const output=await standard(url,init);if(new URL(url).pathname.startsWith('/v1/images/')){
   const s=(await slotCreatives.detail(alice,brand.id,original.id)).slot;
   queued=cancel?await plans.review(alice,brand.id,s.id,decision(s,'cancelled')):await plans.edit(alice,brand.id,s.id,{revision:s.revision,brief:'Newer owner brief'});
  }return output;};
  try{const j=await slotCreatives.generate(alice,brand.id,original.id,{revision:original.revision},randomUUID());assert.equal(await handler.run(scope(j)),'succeeded',JSON.stringify(await row(j)));}
  finally{transport=undefined;}
  const d=await slotCreatives.detail(alice,brand.id,original.id);assert.equal(d.slot.revision,queued.revision);assert.equal(d.slot.state,queued.state);assert.equal(d.slot.brief,queued.brief);assert.equal(d.slot.creative_version_id,null);
  assert.equal(d.generations[0].attachment_status,'needs_attachment');assert.ok(d.generations[0].output_version_id);assert.ok(!d.events.some(e=>e.action==='creative_attached'));
  const p=await canvas.project(alice,brand.id,d.generations[0].project_id);assert.equal(p.project.latest_version_id,d.generations[0].output_version_id);
 }
});
test('a changed plan before execution is rejected without spending; link insertion failure rolls back all queued state',async()=>{
 const s=await plannedSlot(),j=await slotCreatives.generate(alice,brand.id,s.id,{revision:s.revision},randomUUID());
 await plans.edit(alice,brand.id,s.id,{revision:s.revision+1,brief:'Changed before execution'});
 const calls=planCalls+imageCalls;assert.equal(await handler.run(scope(j)),'rejected');assert.equal((await row(j)).error_code,'CREATIVE_SLOT_CHANGED');assert.equal(planCalls+imageCalls,calls);
 const other=await plannedSlot();const before=(await admin.query('SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1',[brand.id])).rows[0].n;
 await admin.query("CREATE FUNCTION app.test_fail_slot_link() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST link persistence failed'; END$$");
 await admin.query('CREATE TRIGGER test_fail_slot_link BEFORE INSERT ON app.content_slot_generations FOR EACH ROW EXECUTE FUNCTION app.test_fail_slot_link()');
 try{await assert.rejects(slotCreatives.generate(alice,brand.id,other.id,{revision:other.revision},randomUUID()),/TEST link persistence failed/);}
 finally{await admin.query('DROP TRIGGER test_fail_slot_link ON app.content_slot_generations');await admin.query('DROP FUNCTION app.test_fail_slot_link()');}
 const d=await slotCreatives.detail(alice,brand.id,other.id);assert.equal(d.slot.revision,other.revision);assert.equal(d.events.length,1);assert.equal(d.generations.length,0);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1',[brand.id])).rows[0].n,before);
});
test('slot promotion failure rolls back version/attachment/event and retries cached provider output without another paid call',async()=>{
 const s=await plannedSlot(),j=await slotCreatives.generate(alice,brand.id,s.id,{revision:s.revision},randomUUID());
 await admin.query("CREATE FUNCTION app.test_fail_slot_attach() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='creative_attached' THEN RAISE EXCEPTION 'TEST attachment failed'; END IF; RETURN NEW; END$$");
 await admin.query('CREATE TRIGGER test_fail_slot_attach BEFORE INSERT ON app.content_slot_events FOR EACH ROW EXECUTE FUNCTION app.test_fail_slot_attach()');
 try{await assert.rejects(handler.run(scope(j)),/TEST attachment failed/);}
 finally{await admin.query('DROP TRIGGER test_fail_slot_attach ON app.content_slot_events');await admin.query('DROP FUNCTION app.test_fail_slot_attach()');}
 const d=await slotCreatives.detail(alice,brand.id,s.id);assert.equal(d.slot.creative_version_id,null);assert.equal(d.generations[0].output_version_id,null);assert.equal(d.generations[0].attachment_status,'pending');
 const calls=planCalls+imageCalls;assert.equal(await handler.run(scope(j)),'succeeded',JSON.stringify(await row(j)));assert.equal(planCalls+imageCalls,calls);
 const saved=await slotCreatives.detail(alice,brand.id,s.id);assert.equal(saved.generations[0].attachment_status,'attached');assert.equal(saved.events.filter(e=>e.action==='creative_attached').length,1);
});
