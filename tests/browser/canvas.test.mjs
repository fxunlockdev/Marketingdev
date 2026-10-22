// Browser integration proof uses real auth, RLS, Temporal, S3, Fabric and isolated
// owner skills. Only the paid OpenAI transport is MOCK; no provider request leaves this test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { Worker, NativeConnection } from "@temporalio/worker";
import { Connection, Client } from "@temporalio/client";
import { Context } from "@temporalio/activity";
import OpenAI from "openai";
import sharp from "sharp";
import { createApplication } from "../../dist/app.js";
import { BrandBrain } from "../../dist/brand-brain.js";
import { ObjectStore } from "../../dist/object-store.js";
import { AssetJobs, JobDispatcher } from "../../dist/jobs.js";
import { CreativeJobs } from "../../dist/creative-jobs.js";
import { CreativeProvider } from "../../dist/creative-provider.js";
import { SkillRuntime } from "../../dist/skill-runtime.js";
import { startMailbox, messageLink } from "../foundation/smtp.mjs";
import { port } from "../../scripts/storage-test-services.mjs";
const config = JSON.parse(process.env.DESVIO_TEST_CONFIG),
  admin = new Pool({ connectionString: process.env.DESVIO_TEST_ADMIN_URL }),
  workerPool = new Pool({ connectionString: config.jobs.workerDatabaseUrl }),
  dispatchPool = new Pool({
    connectionString: config.jobs.dispatcherDatabaseUrl,
  });
const children = [],
  errors = [];
let runtime,
  smtp,
  browser,
  page,
  base,
  store,
  temporal,
  native,
  connection,
  workerRun,
  dispatchTimer,
  dispatching = false,
  brand,
  org,
  actor,
  generated = 0,
  planned = 0,
  latestMedia,
  failImages = false;
const png = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: "#e6d5bb" },
})
  .png()
  .toBuffer();
function command(args, env, onOutput) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (b) => onOutput(b.toString()));
  child.stderr.on("data", (b) => onOutput(b.toString()));
  return child;
}
async function waitFor(f) {
  for (let i = 0; i < 100; i++) {
    if (await f()) return;
    await delay(100);
  }
  throw new Error("Local service did not become ready");
}
async function post(path, body, key) {
  return page.evaluate(
    async ({ path, body, key }) => {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { "idempotency-key": key } : {}),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body, key },
  );
}
before(async () => {
  await mkdir("work/browser", { recursive: true });
  smtp = await startMailbox();
  config.smtp.port = smtp.port;
  base = `http://127.0.0.1:${await port()}`;
  config.origin = base;
  config.jobs.taskQueue = "canvas-browser-" + randomUUID();
  runtime = await createApplication(config);
  await runtime.app.listen(0, "127.0.0.1");
  const s3 = new S3Client({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: config.storage.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [base],
            AllowedMethods: ["GET", "PUT"],
            AllowedHeaders: ["content-type"],
            MaxAgeSeconds: 60,
          },
        ],
      },
    }),
  );
  s3.destroy();
  let logs = "";
  const env = {
    API_ORIGIN: await runtime.app.getUrl(),
    S3_BROWSER_ORIGIN: config.storage.endpoint,
  };
  const build = command(
    ["node_modules/next/dist/bin/next", "build", "apps/web", "--webpack"],
    env,
    (s) => (logs = (logs + s).slice(-6000)),
  );
  assert.equal((await once(build, "exit"))[0], 0, logs);
  command(
    [
      "node_modules/next/dist/bin/next",
      "start",
      "apps/web",
      "-H",
      "127.0.0.1",
      "-p",
      new URL(base).port,
    ],
    env,
    (s) => (logs = (logs + s).slice(-6000)),
  );
  await waitFor(async () => {
    try {
      return (await fetch(base + "/sign-in")).ok;
    } catch {
      return false;
    }
  });
  store = new ObjectStore(config.storage);
  const jobs = new AssetJobs(workerPool, store, null);
  const provider = new CreativeProvider(
    undefined,
    new OpenAI({
      apiKey: "fixture-only",
      maxRetries: 0,
      fetch: async (url, init) => {
        if (String(url).startsWith("data:")) return fetch(url, init);
        if (new URL(url).pathname === "/v1/responses") {
          planned++;
          const body = JSON.parse(init.body),
            entry = body.input.find(
              (m) =>
                m.role === "user" &&
                m.content.startsWith("UNTRUSTED BUSINESS DATA AND REQUEST:\n"),
            ),
            input = JSON.parse(
              entry.content.slice(entry.content.indexOf("\n") + 1),
            );
          assert.ok(
            input.brand.facts.every((f) => !f.value.includes("OTHER BUSINESS")),
          );
          const brief = {
            headline:
              planned === 1
                ? "TEST FIXTURE: A little everyday care"
                : "TEST FIXTURE: Fresh perspective",
            body: "Refillable botanical soap",
            cta: "Explore the collection",
            caption:
              "TEST FIXTURE: Botanical soap, made for your everyday ritual.",
            image_prompt: "TEST FIXTURE: Still life with room for text",
            palette: ["#e6d5bb", "#201e1d"],
            fact_ids: [
              input.brand.facts.find((f) => f.field === "offering").id,
            ],
            warnings: ["TEST FIXTURE — no live generation"],
          };
          return Response.json({
            id: "resp_fixture",
            object: "response",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(brief),
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
          });
        }
        generated++;
        if (failImages) throw new TypeError("MOCK lost response");
        if (new URL(url).pathname === "/v1/images/edits")
          assert.equal(init.body.get("image").type, "image/png");
        else assert.equal(new URL(url).pathname, "/v1/images/generations");
        return Response.json({
          created: 1,
          data: [{ b64_json: png.toString("base64") }],
        });
      },
    }),
  );
  const handler = new CreativeJobs(
    jobs,
    new SkillRuntime(process.env.SKILL_RUNTIME_IMAGE),
    provider,
  );
  native = await NativeConnection.connect({ address: config.jobs.address });
  connection = await Connection.connect({ address: config.jobs.address });
  temporal = await Worker.create({
    connection: native,
    namespace: config.jobs.namespace,
    taskQueue: config.jobs.taskQueue,
    workflowsPath: fileURLToPath(
      new URL("../../dist/asset-workflow.js", import.meta.url),
    ),
    activities: {
      generateCreative: async (scope) => {
        const context = Context.current(),
          timer = setInterval(() => context.heartbeat(), 1000);
        try {
          return await handler.run(scope);
        } finally {
          clearInterval(timer);
        }
      },
      failCreative: (scope) => handler.fail(scope),
    },
  });
  workerRun = temporal.run();
  const dispatcher = new JobDispatcher(
    dispatchPool,
    new Client({ connection, namespace: config.jobs.namespace }),
    config.jobs.taskQueue,
  );
  dispatchTimer = setInterval(async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      await dispatcher.runOnce();
    } catch (e) {
      errors.push(e.message);
    } finally {
      dispatching = false;
    }
  }, 100);
  browser = await chromium.launch();
  page = await (
    await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  ).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|Refused to/.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto(base + "/sign-up");
  await page.getByLabel("Your name").fill("Canvas Tester");
  await page.getByLabel("Email address").fill("canvas-browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("canvas-browser-test-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await waitFor(async () => {
    while (await runtime.mailWorker.runOnce()) {}
    return smtp.messages.length > 0;
  });
  await page.goto(messageLink(smtp.messages[0]).toString());
  await page.getByLabel("Email address").fill("canvas-browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("canvas-browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
  actor = (
    await admin.query('SELECT id FROM auth."user" WHERE email=$1', [
      "canvas-browser@example.test",
    ])
  ).rows[0].id;
  const created = await post(
    "/api/v1/businesses",
    { name: "Cedar & Bloom" },
    randomUUID(),
  );
  assert.equal(created.status, 201);
  brand = created.body.id;
  org = (
    await admin.query("SELECT organization_id FROM app.brands WHERE id=$1", [
      brand,
    ])
  ).rows[0].organization_id;
  const brain = new BrandBrain(runtime.database);
  for (const [field, value] of [
    ["brand_name", "Cedar & Bloom"],
    ["offering", "Refillable botanical soap"],
    ["audience", "Mindful households"],
  ])
    await brain.manual(actor, org, brand, { field, value }, randomUUID());
  let state = await brain.read(actor, org, brand);
  for (const f of state.findings)
    await brain.review(actor, org, brand, f.id, {
      decision: "correct",
      revision: f.revision,
    });
  state = await brain.read(actor, org, brand);
  await brain.approve(actor, org, brand, { revision: state.revision });
  await admin.query(
    "INSERT INTO app.creative_grants(organization_id,brand_id,text_model,image_model,quality,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,max_image_request_micros,approved_by,enabled) VALUES($1,$2,'MOCK-text','gpt-image-fixture','low',now()+interval '1 hour',10000000,0.01,0.02,100000,'LOCAL BROWSER TEST ONLY',true)",
    [org, brand],
  );
});
after(async () => {
  clearInterval(dispatchTimer);
  while (dispatching) await delay(50);
  if (temporal) {
    temporal.shutdown();
    await workerRun;
  }
  await native?.close();
  await connection?.close();
  await browser?.close();
  for (const c of children.reverse()) {
    if (c.exitCode === null && c.signalCode === null) {
      const done = once(c, "exit");
      c.kill("SIGTERM");
      await Promise.race([done, delay(3000)]);
      if (c.exitCode === null && c.signalCode === null) {
        c.kill("SIGKILL");
        await done;
      }
    }
  }
  store?.close();
  await runtime?.close();
  await smtp?.close();
  await Promise.all([admin.end(), workerPool.end(), dispatchPool.end()]);
});
test("Canvas browser creates a real queued job, renders a private creative and saves editable Fabric layers (MOCK OpenAI)", async () => {
  await page.goto(`${base}/b/${brand}/canvas`);
  await page
    .getByLabel("Describe your creative")
    .fill("TEST FIXTURE: Create a calm botanical soap launch");
  await page
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  await expect(page.getByLabel("Layer text")).toHaveValue(
    "TEST FIXTURE: A little everyday care",
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", { name: "Download PNG" }),
  ).toBeEnabled();
  assert.equal(generated, 1);
  assert.equal(planned, 1);
  const job = (
    await admin.query(
      "SELECT status FROM app.jobs WHERE brand_id=$1 AND kind=$2",
      [brand, "creative.generate"],
    )
  ).rows[0];
  assert.equal(job.status, "succeeded");
  await page.getByLabel("Layer text").fill("Made for your everyday ritual");
  await page.getByLabel("Font", { exact: true }).selectOption("Georgia");
  await page.getByLabel("Font size").fill("60");
  await page.getByLabel("Left position").fill("80");
  await page
    .getByLabel("Post caption")
    .fill("TEST FIXTURE: A calmer daily ritual.");
  await expect(
    page.getByRole("button", { name: "Download PNG" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(
    page.getByText("Saved as a new draft version.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Layer text")).toHaveValue(
    "Made for your everyday ritual",
  );
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("Georgia");
  await expect(page.getByLabel("Left position")).toHaveValue("80");
  const versions = (
    await admin.query(
      "SELECT * FROM app.creative_versions WHERE brand_id=$1 ORDER BY created_at",
      [brand],
    )
  ).rows;
  assert.equal(versions.length, 2);
  assert.equal(
    versions[0].design.layers[0].text,
    "TEST FIXTURE: A little everyday care",
  );
  assert.equal(
    versions[1].design.layers[0].text,
    "Made for your everyday ritual",
  );
  latestMedia = versions[1].media_id;
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  const download = await downloadEvent,
    bytes = await readFile(await download.path()),
    meta = await sharp(bytes).metadata();
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1024);
  const corner = await sharp(bytes)
    .extract({ left: 1000, top: 1000, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(
    [...corner],
    [230, 213, 187],
    "background covers the entire exported image",
  );
  assert.notEqual(
    bytes.toString("base64"),
    png.toString("base64"),
    "export includes editable text",
  );
  await page.getByRole("heading", { name: "Canvas", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "work/browser/canvas-editor-desktop.png",
    fullPage: true,
  });
  const violations = (
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
  ).violations;
  assert.deepEqual(
    violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    [],
  );
});
test("Canvas review applies to the saved version; AI edits create a draft and stale/manual edits stay protected", async () => {
  await page.getByLabel("Review feedback").fill("Ready for a human review");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(
    page.getByRole("button", { name: "Approve version" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve version" }).click();
  await expect(
    page.getByText(
      "This saved version is approved. It has not been published.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revise image with AI" }).click();
  await page
    .getByLabel("Describe your changes")
    .fill("TEST FIXTURE: Make the background more botanical");
  await page
    .getByRole("button", { name: "Generate revision", exact: true })
    .click();
  await expect(page.getByLabel("Layer text")).toHaveValue(
    "TEST FIXTURE: Fresh perspective",
    { timeout: 30000 },
  );
  assert.equal(generated, 2);
  const state = (
    await admin.query(
      "SELECT status FROM app.creative_versions WHERE brand_id=$1 ORDER BY created_at",
      [brand],
    )
  ).rows;
  assert.deepEqual(
    state.map((v) => v.status),
    ["draft", "approved", "draft"],
  );
  await page.getByLabel("Layer text").fill("Unsaved browser work");
  await page.route("**/creative-projects/*/versions", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "TEST FIXTURE failure" }),
    }),
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.locator(".notice.error")).toContainText("couldn’t save");
  await expect(page.getByLabel("Layer text")).toHaveValue(
    "Unsaved browser work",
  );
  await page.unroute("**/creative-projects/*/versions");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Saved as a new draft version.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Canvas", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "work/browser/canvas-editor-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()
    ).violations.map((v) => v.id),
    [],
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const anonymous = await browser.newContext();
  assert.equal(
    (
      await anonymous.request.get(
        `${base}/api/v1/businesses/${brand}/creative-media/${latestMedia}`,
      )
    ).status(),
    401,
  );
  await anonymous.close();
  const other = await post(
    "/api/v1/businesses",
    { name: "OTHER BUSINESS" },
    randomUUID(),
  );
  assert.equal(other.status, 201);
  assert.equal(
    (
      await page.request.get(
        `${base}/api/v1/businesses/${other.body.id}/creative-media/${latestMedia}`,
      )
    ).status(),
    404,
  );
  assert.deepEqual(errors, []);
});
test("Canvas displays an uncertain provider result and holds further generation across reloads (MOCK network loss)", async () => {
  failImages = true;
  await page
    .getByRole("button", { name: "+ New conversation", exact: true })
    .click();
  await page
    .getByLabel("Describe your creative")
    .fill("TEST FIXTURE: uncertain generation");
  await page
    .getByRole("button", { name: "Generate image", exact: true })
    .click();
  await expect(
    page.getByText("Needs reconciliation", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Generate image", exact: true }),
  ).toBeDisabled();
  assert.equal(generated, 3);
  await page.reload();
  await expect(
    page.getByText("Needs reconciliation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate image", exact: true }),
  ).toBeDisabled();
  assert.equal(generated, 3);
  assert.deepEqual(errors, []);
});
