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
              "SELECT object_key FROM app.creative_media ORDER BY created_at LIMIT 1",
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
