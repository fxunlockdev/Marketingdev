import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import OpenAI from "openai";
import { TenantDatabase } from "../../dist/database.js";
import { Workspaces } from "../../dist/workspaces.js";
import { Businesses } from "../../dist/businesses.js";
import { Intake } from "../../dist/intake.js";
import { IntakeJobs } from "../../dist/intake-jobs.js";
import { AssetJobs } from "../../dist/jobs.js";
import { BrandBrain } from "../../dist/brand-brain.js";
import { BrandAnalyzer } from "../../dist/brand-analysis.js";
import { WebsiteParser } from "../../dist/website-parser.js";
import { WebsiteReader } from "../../dist/safe-web.js";
import { VisualCrawler, VISUAL_VERSION } from "../../dist/visual-crawler.js";
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
  parser = new WebsiteParser(process.env.DOCUMENT_PARSER_IMAGE);
const alice = randomUUID(),
  bob = randomUUID();
let org, brand, capturedVisual;
const html =
  '<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Acme makes scheduling tools for dental practices.</p><a href="/about">About</a><script>fetch("http://169.254.169.254/secret")</script><iframe src="http://127.0.0.1/secret"></iframe></body></html>';
const reader = new WebsiteReader({
  fetch: async (u) =>
    u.pathname === "/robots.txt"
      ? {
          status: 200,
          headers: {},
          bytes: Buffer.from("User-agent: *\nDisallow: /about"),
        }
      : {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          bytes: Buffer.from(html),
        },
});
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
test("actual isolated Chromium renders JavaScript, images, typography and desktop/mobile screenshots (MOCK resource transport)", async () => {
  const fetched = [];
  const broker = {
    fetch: async (u) => {
      fetched.push(u.href);
      const path = u.pathname;
      if (path === "/design.css")
        return {
          status: 200,
          headers: { "content-type": "text/css" },
          bytes: Buffer.from(
            "body{background:#f4e8d1;color:#263e33;font-family:Georgia;margin:40px}h1{font-size:48px}section{height:1100px}",
          ),
        };
      if (path === "/brand.js")
        return {
          status: 200,
          headers: { "content-type": "application/javascript" },
          bytes: Buffer.from(
            'document.querySelector("h1").textContent="Acme rendered identity";fetch("http://127.0.0.1/private").catch(()=>{});',
          ),
        };
      if (path === "/logo.svg")
        return {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
          bytes: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="#263e33"/><text x="15" y="40" fill="white" font-size="30">Acme</text></svg>',
          ),
        };
      throw new Error("Unexpected fixture resource");
    },
  };
  const visual = await new VisualCrawler(
    process.env.DOCUMENT_PARSER_IMAGE,
    broker,
  ).capture(
    "https://example.org/",
    '<!doctype html><html><head><link rel="stylesheet" href="/design.css"></head><body><header><img src="/logo.svg" alt="Acme logo"></header><h1>Before JavaScript</h1><section>Crafted products for home. We create considered everyday objects using natural materials, calm colours and useful forms. Our collection includes refillable soaps, cotton towels and ceramic accessories designed for independent homeware stores. Each product comes with clear care instructions and reusable packaging. Explore our collection, learn about the makers, or speak with our team about wholesale orders.</section><script src="/brand.js"></script></body></html>',
  );
  assert.equal(visual.version, VISUAL_VERSION);
  assert.equal(visual.snapshots.length, 2);
  for (const shot of visual.snapshots) {
    assert.match(shot.observations.text, /Acme rendered identity/);
    assert.ok(
      shot.observations.images.some(
        (i) => i.loaded && i.role === "logo_candidate",
      ),
    );
    assert.ok(
      shot.observations.typography.some((t) => t.family.includes("Georgia")),
    );
    assert.ok(
      shot.observations.colors.some((c) => c.value === "rgb(244, 232, 209)"),
    );
    assert.ok(shot.screenshot.length > 1000);
  }
  assert.ok(fetched.some((u) => u.endsWith("/brand.js")));
  assert.ok(!fetched.some((u) => u.includes("127.0.0.1")));
  assert.ok(visual.failures.some((f) => f.url.includes("127.0.0.1")));
  capturedVisual = visual;
});
test("actual network-disabled Crawl4AI parser, provenance, robots coverage and idempotent scoped jobs (MOCK page transport)", async () => {
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
    await assert.rejects(
      jobs.transaction(scope(j), (db) =>
        db.query("SELECT * FROM app.brand_brain_versions"),
      ),
      /permission denied/,
    );
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
      "The real renderer must pass before its captured pixels can be persisted",
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
    } finally {
      store.close();
    }
  },
);
