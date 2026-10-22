import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createApplication } from "../../dist/app.js";
import { ObjectStore, digest } from "../../dist/object-store.js";
import { AssetJobs } from "../../dist/jobs.js";
import { MalwareScanner } from "../../dist/file-validation.js";
import {
  DocumentParser,
  parseDocumentOutput,
} from "../../dist/document-parser.js";
import { canonicalJSON, hash } from "../../dist/brand-brain.js";
import { startMailbox, messageLink } from "./smtp.mjs";
const config = JSON.parse(process.env.DESVIO_TEST_CONFIG),
  admin = new Pool({ connectionString: process.env.DESVIO_TEST_ADMIN_URL });
const workerPool = new Pool({
    connectionString: config.jobs.workerDatabaseUrl,
  }),
  appPool = new Pool({ connectionString: config.appDatabaseUrl }),
  store = new ObjectStore(config.storage);
let runtime,
  smtp,
  base,
  alice,
  bob,
  org,
  brand,
  worker,
  output = "",
  pdfAsset,
  pdfJob;
const parser = new DocumentParser(process.env.DOCUMENT_PARSER_IMAGE);
async function request(
  path,
  { cookie = alice?.cookie, body, method = "GET", key } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      origin: config.origin,
      ...(cookie ? { cookie } : {}),
      ...(["POST", "PATCH"].includes(method)
        ? { "content-type": "application/json" }
        : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    body: ["POST", "PATCH"].includes(method)
      ? JSON.stringify(body ?? {})
      : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  };
}
const path = () => `/api/v1/workspaces/${org.id}/brands/${brand.id}`;
async function signup(label) {
  const email = `${label}@example.test`,
    r = await request("/api/auth/sign-up/email", {
      method: "POST",
      body: { name: label, email, password: "strong-brand-password-2026" },
    });
  assert.equal(r.status, 200);
  while (await runtime.mailWorker.runOnce()) {}
  const link = messageLink(
    smtp.messages.findLast((m) => m.to.value[0].address === email),
  );
  await fetch(base + link.pathname + link.search, { redirect: "manual" });
  const login = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password: "strong-brand-password-2026" },
  });
  assert.equal(login.status, 200);
  return { id: r.body.user.id, cookie: login.cookie };
}
async function waitJob(job, expected = "succeeded") {
  for (let i = 0; i < 450; i++) {
    const r = await request(`${path()}/jobs/${job.id}`);
    assert.equal(r.status, 200);
    if (
      ["succeeded", "failed", "rejected", "canceled"].includes(r.body.status)
    ) {
      assert.equal(r.body.status, expected, JSON.stringify(r.body));
      return r.body;
    }
    await setTimeout(200);
  }
  throw new Error(`Document workflow timeout ${output.slice(-1200)}`);
}
async function upload(name) {
  const bytes = await readFile(`work/document-fixtures/${name}`),
    contentType = name.endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const a = await request(path() + "/uploads", {
    method: "POST",
    key: randomUUID(),
    body: {
      filename: name,
      contentType,
      bytes: bytes.length,
      sha256: digest(bytes),
    },
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const put = await fetch(a.body.upload.url, {
    method: "PUT",
    headers: a.body.upload.headers,
    body: bytes,
  });
  assert.equal(put.status, 200);
  const completed = await request(`${path()}/assets/${a.body.id}/complete`, {
    method: "POST",
  });
  assert.equal(completed.status, 201);
  await waitJob(completed.body);
  return a.body;
}
async function extract(asset, key = randomUUID()) {
  const r = await request(`${path()}/assets/${asset.id}/extract`, {
    method: "POST",
    key,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function brain() {
  const r = await request(path() + "/brain");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
async function review(f, decision = "correct", value) {
  return request(`${path()}/brain/findings/${f.id}`, {
    method: "PATCH",
    body: {
      revision: f.revision,
      decision,
      ...(value === undefined ? {} : { value }),
    },
  });
}
async function approve(revision) {
  return request(path() + "/brain/approve", {
    method: "POST",
    body: { revision },
  });
}
async function manual(field, value, key = randomUUID()) {
  const r = await request(path() + "/brain/findings", {
    method: "POST",
    key,
    body: { field, value },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
function startWorker() {
  worker = spawn(process.execPath, ["dist/worker-main.js"], {
    env: {
      ...process.env,
      APP_MODE: "test",
      S3_ENDPOINT: config.storage.endpoint,
      S3_REGION: config.storage.region,
      S3_BUCKET: config.storage.bucket,
      S3_ACCESS_KEY_ID: config.storage.accessKeyId,
      S3_SECRET_ACCESS_KEY: config.storage.secretAccessKey,
      CLAMD_HOST: config.scanner.host,
      CLAMD_PORT: String(config.scanner.port),
      WORKER_DATABASE_URL: config.jobs.workerDatabaseUrl,
      DISPATCHER_DATABASE_URL: config.jobs.dispatcherDatabaseUrl,
      TEMPORAL_ADDRESS: config.jobs.address,
      TEMPORAL_NAMESPACE: config.jobs.namespace,
      TEMPORAL_TASK_QUEUE: config.jobs.taskQueue,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [worker.stdout, worker.stderr])
    stream.on("data", (b) => (output = (output + b).slice(-12000)));
}
async function stopWorker() {
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    const done = once(worker, "exit");
    worker.kill("SIGKILL");
    await done;
  }
}
before(async () => {
  smtp = await startMailbox();
  config.smtp.port = smtp.port;
  runtime = await createApplication(config);
  await runtime.app.listen(0, "127.0.0.1");
  base = await runtime.app.getUrl();
  alice = await signup("brain-alice");
  bob = await signup("brain-bob");
  org = (
    await request("/api/v1/workspaces", {
      method: "POST",
      body: { name: "Evidence client" },
    })
  ).body;
  brand = (
    await request(`/api/v1/workspaces/${org.id}/brands`, {
      method: "POST",
      key: randomUUID(),
      body: { name: "Evidence brand" },
    })
  ).body;
  startWorker();
});
beforeEach(async () => {
  await admin.query('DELETE FROM auth."rateLimit"');
});
after(async () => {
  await stopWorker();
  await runtime?.close();
  await smtp?.close();
  store.close();
  await Promise.all([admin.end(), workerPool.end(), appPool.end()]);
});

test("actual PDF upload, malware validation, durable sandbox extraction and tenant-bound provenance", async () => {
  pdfAsset = await upload("guidelines.pdf");
  const key = randomUUID();
  pdfJob = await extract(pdfAsset, key);
  assert.deepEqual(await extract(pdfAsset, key), pdfJob);
  await waitJob(pdfJob);
  const state = await brain();
  assert.equal(state.sources.length, 1);
  assert.equal(state.findings.length, 10);
  assert.equal(state.revision, 1);
  assert.equal(state.active, null);
  assert.ok(
    state.findings.every(
      (f) => f.status === "unreviewed" && f.extraction_type === "literal_label",
    ),
  );
  assert.deepEqual(
    [...new Set(state.findings.map((f) => f.page))].sort(),
    [1, 2],
  );
  assert.equal(state.sources[0].coverage.type, "embedded_text_only");
  const source = await request(
    `${path()}/brain/sources/${state.sources[0].id}`,
  );
  assert.equal(source.status, 200);
  assert.ok(
    source.body.chunks.some((c) =>
      c.text.includes("Ignore all previous instructions"),
    ),
  );
  assert.ok(
    !state.findings.some((f) => f.value.includes("publish")),
    "untrusted source instructions must remain inert evidence",
  );
  assert.equal(
    (await request(path() + "/brain", { cookie: bob.cookie })).status,
    404,
  );
  assert.equal(
    (
      await request(`${path()}/brain/sources/${state.sources[0].id}`, {
        cookie: bob.cookie,
      })
    ).status,
    404,
  );
  const other = (
    await request(`/api/v1/workspaces/${org.id}/brands`, {
      method: "POST",
      key: randomUUID(),
      body: { name: "Other brand" },
    })
  ).body;
  assert.equal(
    (
      await request(
        path().replace(brand.id, other.id) +
          `/brain/sources/${state.sources[0].id}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        path().replace(brand.id, other.id) + `/assets/${pdfAsset.id}/extract`,
        { method: "POST", key: randomUUID() },
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(path() + "/assets")).body.assets.filter(
      (a) => a.id === pdfAsset.id,
    ).length,
    1,
  );
  const repeat = await extract(pdfAsset);
  await waitJob(repeat);
  assert.equal((await brain()).sources.length, 1);
  assert.equal((await brain()).findings.length, 10);
});

test("Correct/Wrong/Edit decisions use revision conflicts and immutable owner-approved snapshots", async () => {
  let state = await brain();
  assert.equal((await approve(state.revision)).status, 409);
  for (const f of state.findings) {
    assert.equal(
      (await review(f, f.field === "colors" ? "wrong" : "correct")).status,
      200,
    );
  }
  const voice = (await brain()).findings.find((f) => f.field === "voice");
  const changed = await review(voice, "edited", "Direct and warm");
  assert.equal(changed.status, 200);
  assert.equal((await review(voice)).status, 409);
  assert.equal(
    (await approve((await brain()).revision)).status,
    409,
    "contradicting accepted voice values must block approval",
  );
  const duplicate = (await brain()).findings.find(
    (f) => f.field === "voice" && f.id !== voice.id,
  );
  assert.equal((await review(duplicate, "wrong")).status, 200);
  assert.equal((await approve(state.revision)).status, 409);
  state = await brain();
  const approved = await approve(state.revision);
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  assert.equal((await approve(state.revision)).body.id, approved.body.id);
  assert.equal(
    approved.body.sha256,
    hash(canonicalJSON(approved.body.snapshot)),
  );
  assert.ok(
    approved.body.snapshot.facts.every(
      (f) => f.reviewed_by === alice.id && f.source_sha256 && f.page,
    ),
  );
  assert.ok(approved.body.snapshot.missing_fields.includes("colors"));
  const old = approved.body;
  const extra = await manual("colors", "#112233");
  assert.equal((await brain()).active.id, old.id);
  assert.equal((await review(extra, "correct")).status, 200);
  const next = await approve((await brain()).revision);
  assert.equal(next.status, 201);
  assert.notEqual(next.body.id, old.id);
  assert.deepEqual(
    (await request(`${path()}/brain/versions/${old.id}`)).body.snapshot,
    old.snapshot,
  );
  await assert.rejects(
    appPool.query("UPDATE app.brand_brain_versions SET snapshot=$1", [
      JSON.stringify({}),
    ]),
    /permission denied/,
  );
  await assert.rejects(
    appPool.query("DELETE FROM app.brand_brain_versions"),
    /permission denied/,
  );
});

test("review roles, manual idempotency and immutable original evidence enforce client boundaries", async () => {
  await admin.query(
    "INSERT INTO app.memberships(organization_id,user_id,role) VALUES($1,$2,'viewer')",
    [org.id, bob.id],
  );
  const finding = (await brain()).findings[0];
  assert.equal(
    (await request(path() + "/brain", { cookie: bob.cookie })).status,
    200,
  );
  assert.equal(
    (
      await request(`${path()}/brain/findings/${finding.id}`, {
        cookie: bob.cookie,
        method: "PATCH",
        body: { revision: finding.revision, decision: "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(`${path()}/assets/${pdfAsset.id}/extract`, {
        cookie: bob.cookie,
        method: "POST",
        key: randomUUID(),
      })
    ).status,
    403,
  );
  await admin.query(
    "UPDATE app.memberships SET role='editor' WHERE organization_id=$1 AND user_id=$2",
    [org.id, bob.id],
  );
  assert.equal(
    (
      await request(path() + "/brain/approve", {
        cookie: bob.cookie,
        method: "POST",
        body: { revision: (await brain()).revision },
      })
    ).status,
    403,
  );
  const key = randomUUID(),
    first = await manual("cta", "Explore the collection", key);
  assert.deepEqual(await manual("cta", "Explore the collection", key), first);
  assert.equal(
    (
      await request(path() + "/brain/findings", {
        method: "POST",
        key,
        body: { field: "cta", value: "Different" },
      })
    ).status,
    409,
  );
  await assert.rejects(
    appPool.query("UPDATE app.brand_findings SET original_value=$1", [
      "rewritten",
    ]),
    /permission denied/,
  );
  await assert.rejects(
    workerPool.query("UPDATE app.brand_findings SET status=$1", ["correct"]),
    /permission denied/,
  );
  // Canvas grants SELECT for the bound creative job only; unscoped workers
  // must still see none of the approved snapshots that exist above.
  assert.equal((await workerPool.query("SELECT * FROM app.brand_brain_versions")).rowCount, 0);
  const scoped = new AssetJobs(
    workerPool,
    store,
    new MalwareScanner(config.scanner),
  );
  await scoped.transaction(
    { organizationId: org.id, brandId: brand.id, jobId: pdfJob.id },
    async (db) => {
      assert.equal(
        (await db.query("SELECT * FROM app.brand_sources")).rowCount,
        1,
      );
      assert.equal(
        (await db.query("UPDATE app.assets SET state='failed'")).rowCount,
        0,
      );
    },
  );
  const validation = (
    await admin.query(
      "SELECT id FROM app.jobs WHERE asset_id=$1 AND kind='asset.validate'",
      [pdfAsset.id],
    )
  ).rows[0];
  await scoped.transaction(
    { organizationId: org.id, brandId: brand.id, jobId: validation.id },
    async (db) =>
      assert.equal(
        (await db.query("SELECT * FROM app.brand_sources")).rowCount,
        0,
      ),
  );
});

test("actual PPTX extraction and a 50-page PDF keep source page coverage; blank scanned-like pages fail clearly", async () => {
  const pptx = await upload("guidelines.pptx");
  await waitJob(await extract(pptx));
  const state = await brain(),
    source = state.sources.find((s) => s.asset_id === pptx.id);
  assert.ok(source);
  assert.equal(source.coverage.pages, 2);
  assert.deepEqual(source.coverage.text_pages, [1, 2]);
  const fifty = await parser.parse(
    await readFile("work/document-fixtures/fifty-pages.pdf"),
    "pdf",
  );
  assert.equal(fifty.pages, 50);
  assert.equal(fifty.textPages.length, 50);
  const blank = await upload("no-text.pdf"),
    job = await extract(blank);
  assert.equal(
    (await waitJob(job, "rejected")).error_code,
    "DOCUMENT_NEEDS_OCR_OR_MANUAL_REVIEW",
  );
  assert.equal(
    (await request(`${path()}/assets/${blank.id}/download`, { method: "POST" }))
      .status,
    201,
    "parser failure must preserve validated upload",
  );
  assert.ok(!(await brain()).sources.some((s) => s.asset_id === blank.id));
});

test("canceled and revoked extraction jobs leave the saved file and prior approved brain intact", async () => {
  const active = (await brain()).active.id;
  await stopWorker();
  let job = await extract(pdfAsset);
  await request(`${path()}/jobs/${job.id}/cancel`, { method: "POST" });
  startWorker();
  await waitJob(job, "canceled");
  await stopWorker();
  job = await extract(pdfAsset);
  await admin.query(
    "UPDATE app.memberships SET active=false WHERE organization_id=$1 AND user_id=$2",
    [org.id, alice.id],
  );
  startWorker();
  try {
    for (let i = 0; i < 150; i++) {
      if (
        (await admin.query("SELECT status FROM app.jobs WHERE id=$1", [job.id]))
          .rows[0].status === "canceled"
      )
        break;
      await setTimeout(200);
    }
    assert.equal(
      (await admin.query("SELECT status FROM app.jobs WHERE id=$1", [job.id]))
        .rows[0].status,
      "canceled",
    );
  } finally {
    await admin.query(
      "UPDATE app.memberships SET active=true WHERE organization_id=$1 AND user_id=$2",
      [org.id, alice.id],
    );
  }
  assert.equal((await brain()).active.id, active);
  assert.equal(
    (
      await request(`${path()}/assets/${pdfAsset.id}/download`, {
        method: "POST",
      })
    ).status,
    201,
  );
});

test("parser rejects malformed, oversized and unconfigured inputs and forged parser output", async () => {
  assert.throws(
    () => new DocumentParser("untrusted:latest"),
    /exact local image digest/,
  );
  await assert.rejects(
    new DocumentParser().parse(Buffer.from("x"), "pdf"),
    /DOCUMENT_PARSER_NOT_CONFIGURED/,
  );
  await assert.rejects(
    parser.parse(Buffer.alloc(20 * 1024 * 1024 + 1), "pdf"),
    /DOCUMENT_LIMIT_EXCEEDED/,
  );
  await assert.rejects(
    parser.parse(Buffer.from("not a PDF"), "pdf"),
    /DOCUMENT_PARSE_FAILED/,
  );
  const bytes = await readFile("work/document-fixtures/guidelines.pdf"),
    valid = await parser.parse(bytes, "pdf");
  assert.throws(
    () =>
      parseDocumentOutput(
        JSON.stringify({ ...valid, sha256: "a".repeat(64) }),
        bytes,
        "pdf",
      ),
    /INVALID_DOCUMENT_OUTPUT/,
  );
  assert.throws(
    () =>
      parseDocumentOutput(
        JSON.stringify({
          ...valid,
          chunks: [{ ...valid.chunks[0], page: 51 }],
        }),
        bytes,
        "pdf",
      ),
    /INVALID_DOCUMENT_OUTPUT/,
  );
});

test("V5 standard account starts empty, initializes once and concurrent fourth-business creation is denied", async () => {
  const initial = await Promise.all(
    Array.from({ length: 3 }, () =>
      request("/api/v1/accounts/current/initialize", { method: "POST" }),
    ),
  );
  assert.ok(initial.every((r) => r.status === 201));
  assert.equal(new Set(initial.map((r) => r.body.accountId)).size, 1);
  const account = initial[0].body.accountId;
  let entitlement = await request("/api/v1/accounts/current/entitlements");
  assert.equal(entitlement.body.active_businesses, 0);
  assert.equal(entitlement.body.max_active_businesses, 3);
  const keys = Array.from({ length: 5 }, () => randomUUID()),
    results = await Promise.all(
      keys.map((key, i) =>
        request("/api/v1/businesses", {
          method: "POST",
          key,
          body: { name: `Owned business ${i}` },
        }),
      ),
    );
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.ok(
    results
      .filter((r) => r.status === 409)
      .every((r) => r.body.error.includes("BUSINESS_LIMIT_REACHED")),
  );
  const winner = results.findIndex((r) => r.status === 201);
  assert.equal(
    (
      await request("/api/v1/businesses", {
        method: "POST",
        key: keys[winner],
        body: { name: `Owned business ${winner}` },
      })
    ).body.id,
    results[winner].body.id,
  );
  assert.equal(
    (await request("/api/v1/accounts/current/entitlements")).body
      .can_create_business,
    false,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM app.brands WHERE organization_id=$1",
        [account],
      )
    ).rows[0].n,
    3,
  );
  // A selected-business seat gets no extra slots and cannot read siblings through any existing route.
  const target = results[winner].body;
  await admin.query(
    "INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'viewer','selected')",
    [account, bob.id],
  );
  await admin.query(
    "INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [account, target.id, bob.id],
  );
  const seen = (
    await request("/api/v1/businesses", { cookie: bob.cookie })
  ).body.businesses.filter((b) => b.organization_id === account);
  assert.deepEqual(
    seen.map((b) => b.id),
    [target.id],
  );
  const hidden = results.find((r, i) => r.status === 201 && i !== winner).body;
  assert.equal(
    (await request(`/api/v1/businesses/${hidden.id}`, { cookie: bob.cookie }))
      .status,
    404,
  );
  assert.equal(
    (
      await request(`/api/v1/workspaces/${account}/brands/${hidden.id}/brain`, {
        cookie: bob.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(`/api/v1/workspaces/${account}/brands`, {
        cookie: bob.cookie,
      })
    ).body.brands.length,
    1,
  );
  const jobPath = `/api/v1/businesses/${target.id}/onboarding`;
  let state = (await request(jobPath)).body;
  assert.equal(state.revision, 0);
  const body = {
    revision: state.revision,
    step: 3,
    goal: "leads",
    timezone: "Asia/Kuala_Lumpur",
    cadence: 4,
    channels: ["linkedin"],
    must_avoid: "No invented claims",
  };
  assert.equal((await request(jobPath, { method: "PATCH", body })).status, 200);
  assert.equal((await request(jobPath)).body.goal, "leads");
  assert.equal((await request(jobPath, { method: "PATCH", body })).status, 409);
  assert.equal(
    (await request(jobPath, { method: "PATCH", cookie: bob.cookie, body }))
      .status,
    403,
  );
});
