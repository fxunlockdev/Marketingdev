import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { createApplication } from "../../dist/app.js";
import { startMailbox, messageLink } from "../foundation/smtp.mjs";
import { port } from "../../scripts/storage-test-services.mjs";
const config = JSON.parse(process.env.DESVIO_TEST_CONFIG),
  admin = new Pool({ connectionString: process.env.DESVIO_TEST_ADMIN_URL }),
  children = [];
let runtime,
  smtp,
  browser,
  alice,
  bob,
  clientUrl,
  brandUrl,
  base,
  mailTimer,
  workerLog = "",
  webLog = "";
const password = "desvio-browser-test-password",
  email = "browser-alice@example.test",
  png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#2355c4" },
  })
    .png()
    .toBuffer();
const errors = [];
function command(args, env, onOutput) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (b) => onOutput?.(b.toString()));
  child.stderr.on("data", (b) => onOutput?.(b.toString()));
  return child;
}
async function drain() {
  while (await runtime.mailWorker.runOnce()) {}
}
async function emailLink(to, subject) {
  for (let i = 0; i < 40; i++) {
    await drain();
    const msg = smtp.messages.findLast(
      (m) => m.to.value[0].address === to && m.subject === subject,
    );
    if (msg) return messageLink(msg).toString();
    await setTimeout(100);
  }
  throw new Error("Expected local email not queued");
}
async function signin(page, address = email, pass = password) {
  await page.goto(base + "/sign-in");
  await page.getByLabel("Email address").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
}
async function signup(page, address, name) {
  await page.goto(base + "/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await page.goto(await emailLink(address, "Verify your Desvio email"));
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
}
before(async () => {
  await mkdir("work/browser", { recursive: true });
  smtp = await startMailbox();
  config.smtp.port = smtp.port;
  base = `http://127.0.0.1:${await port()}`;
  config.origin = base;
  runtime = await createApplication(config);
  await runtime.app.listen(0, "127.0.0.1");
  const apiOrigin = await runtime.app.getUrl();
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
            AllowedMethods: ["PUT", "GET"],
            AllowedHeaders: ["content-type"],
            MaxAgeSeconds: 60,
          },
        ],
      },
    }),
  );
  s3.destroy();
  const webEnv = {
    API_ORIGIN: apiOrigin,
    S3_BROWSER_ORIGIN: config.storage.endpoint,
  };
  const build = command(
    ["node_modules/next/dist/bin/next", "build", "apps/web", "--webpack"],
    webEnv,
    (s) => (webLog = (webLog + s).slice(-5000)),
  );
  const [code] = await once(build, "exit");
  assert.equal(code, 0, webLog);
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
    webEnv,
    (s) => (webLog = (webLog + s).slice(-5000)),
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + "/sign-in");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await setTimeout(100);
  }
  assert.ok(ready, webLog);
  command(
    ["dist/worker-main.js"],
    {
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
    (s) => (workerLog = (workerLog + s).slice(-5000)),
  );
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  alice = await context.newPage();
  alice.on("pageerror", (e) => errors.push(e.message));
  alice.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Content Security Policy|Refused to/.test(m.text())
    )
      errors.push(m.text());
  });
  console.log(
    `Local browser proof at ${base}; actual backend/storage/scanner/worker, local SMTP only`,
  );
});
beforeEach(async () => {
  await admin.query('DELETE FROM auth."rateLimit"');
});
after(async () => {
  if (process.env.DESVIO_VISIBLE_PREVIEW === "1") {
    console.log(`Preview retained for 60 seconds: ${base}/sign-in`);
    await setTimeout(60000);
  }
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([done, setTimeout(3000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await done;
      }
    }
  }
  await runtime?.close();
  await smtp?.close();
  await admin.end();
});

let firstBusiness, secondBusiness;
async function createBusiness(name) {
  await alice.goto(base + "/brands/new");
  await alice.getByLabel("Business name", { exact: true }).fill(name);
  await alice
    .getByRole("button", { name: "Save & continue", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Make it unmistakably yours." }),
  ).toBeVisible();
  return alice.url().split("/b/")[1].split("/")[0];
}
async function addFact(field, value) {
  await alice.getByLabel("Brand field", { exact: true }).selectOption(field);
  await alice.getByLabel("Fact", { exact: true }).fill(value);
  await alice
    .getByRole("button", { name: "Add for review", exact: true })
    .click();
  await expect(
    alice.locator(".finding-card").filter({ hasText: value }),
  ).toBeVisible();
}

test("V5 signup and real email verification lead to zero businesses and exact navigation", async () => {
  await signup(alice, email, "Alex Morgan");
  await signin(alice);
  await expect(
    alice.getByRole("link", { name: "Add your first business" }),
  ).toBeVisible();
  assert.deepEqual(await alice.locator("#business-nav a").allTextContents(), [
    "Overview",
    "Brands",
    "Content Plan",
    "Review Inbox",
    "Canvas",
    "Publishing & Analytics",
    "Memory",
    "Connections",
    "Team",
    "Billing",
    "Profile",
  ]);
  await alice.goto(base + "/brands");
  await expect(
    alice.getByText("0 of 3 owned businesses", { exact: false }),
  ).toBeVisible();
  assert.equal(await alice.locator(".v5-business-card").count(), 0);
  const colors = await alice.evaluate(() => ({
    paper: getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim(),
    ink: getComputedStyle(document.documentElement)
      .getPropertyValue("--ink")
      .trim(),
  }));
  assert.deepEqual(colors, { paper: "#f5ead8", ink: "#201e1d" });
});

test("three-step manual fallback saves evidence, corrections, goals and immutable brand memory", async () => {
  firstBusiness = await createBusiness("Olive & Field");
  brandUrl = base + `/b/${firstBusiness}/onboarding`;
  await alice.reload();
  await expect(
    alice.getByRole("heading", { name: "Make it unmistakably yours." }),
  ).toBeVisible();
  await addFact("brand_name", "Olive & Field");
  await addFact("offering", "Refillable botanical soap");
  await addFact("audience", "Independent homeware shops");
  for (const card of await alice.locator(".finding-card").all())
    await card.getByRole("button", { name: "Correct", exact: true }).click();
  await expect(alice.getByText("Needs review", { exact: true })).toHaveCount(0);
  await alice
    .getByRole("button", { name: "Save & continue to goals →" })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Review your direction" }),
  ).toBeVisible();
  await expect(
    alice.getByText("No AI recommendations yet.", {
      exact: true,
    }),
  ).toBeVisible();
  await alice.getByLabel("Primary goal").selectOption("leads");
  await alice
    .getByLabel("Time zone", { exact: true })
    .fill("Asia/Kuala_Lumpur");
  await alice.getByRole("button", { name: "Save goals", exact: true }).click();
  await alice.reload();
  await expect(alice.getByLabel("Primary goal")).toHaveValue("leads");
  await alice.getByRole("button", { name: "Confirm brand profile" }).click();
  await expect(
    alice.getByRole("heading", { name: "Your brand facts are confirmed." }),
  ).toBeVisible();
  await alice.getByRole("link", { name: "View brand memory" }).click();
  await expect(alice.locator(".memory-facts")).toContainText(
    "Refillable botanical soap",
  );
  await alice.reload();
  await expect(alice.locator(".memory-facts")).toContainText(
    "Independent homeware shops",
  );
});

test("real private upload survives refresh and download returns the original bytes", async () => {
  await alice.goto(brandUrl);
  await alice.getByRole("button", { name: "Back to brand review" }).click();
  await expect(alice.getByLabel("Choose a brand file")).toBeVisible();
  await alice.getByLabel("Choose a brand file").setInputFiles({
    name: "brand-reference.png",
    mimeType: "image/png",
    buffer: png,
  });
  await alice.getByRole("button", { name: "Upload file", exact: true }).click();
  await expect(
    alice.getByText("Ready to download", { exact: false }),
  ).toBeVisible({ timeout: 60000 });
  await alice.reload();
  await expect(
    alice.getByText("brand-reference.png", { exact: true }),
  ).toBeVisible();
  const promise = alice.waitForEvent("download");
  await alice.getByRole("button", { name: "Download", exact: true }).click();
  const stream = await (await promise).createReadStream(),
    chunks = [];
  for await (const c of stream) chunks.push(c);
  assert.deepEqual(Buffer.concat(chunks), png);
  assert.deepEqual(errors, []);
});

test("failed and stale fact edits preserve entered corrections and require explicit recovery", async () => {
  const card = alice
    .locator(".finding-card")
    .filter({ hasText: "Refillable botanical soap" });
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  await card.getByLabel("Edit offering").fill("Refillable soap and hand wash");
  await alice.route("**/brain/findings/*", (r) =>
    r.request().method() === "PATCH" ? r.abort() : r.continue(),
  );
  try {
    await card.getByRole("button", { name: "Save correction" }).click();
    await expect(card.getByRole("alert")).toContainText(
      "Your entries are still here",
    );
    await expect(card.getByLabel("Edit offering")).toHaveValue(
      "Refillable soap and hand wash",
    );
  } finally {
    await alice.unroute("**/brain/findings/*");
  }
  await card.getByRole("button", { name: "Save correction" }).click();
  await expect(
    alice
      .locator(".finding-card")
      .filter({ hasText: "Refillable soap and hand wash" }),
  ).toBeVisible();
  const second = await alice.context().newPage();
  await second.goto(brandUrl);
  const secondCard = second.locator(".finding-card").filter({
    has: second.getByRole("heading", { name: "offering", exact: true }),
  });
  await secondCard.getByRole("button", { name: "Edit", exact: true }).click();
  await secondCard.getByLabel("Edit offering").fill("Unsaved alternate");
  await alice
    .locator(".finding-card")
    .filter({ hasText: "Refillable soap and hand wash" })
    .getByRole("button", { name: "Correct", exact: true })
    .click();
  await secondCard.getByRole("button", { name: "Save correction" }).click();
  await expect(secondCard.getByRole("alert")).toContainText("changed");
  await expect(secondCard.getByLabel("Edit offering")).toHaveValue(
    "Unsaved alternate",
  );
  await second.close();
});

test("three saved businesses, server fourth rejection, selector isolation and truthful Canvas", async () => {
  secondBusiness = await createBusiness("Juniper Goods");
  await createBusiness("Northside Studio");
  await alice.goto(base + "/brands");
  await expect(alice.locator(".v5-business-card")).toHaveCount(3);
  await expect(
    alice.getByText("3 of 3 owned businesses", { exact: false }),
  ).toBeVisible();
  await alice.screenshot({
    path: "work/browser/v5-brands-desktop.png",
    fullPage: true,
  });
  await alice.goto(base + "/brands/new");
  await expect(
    alice.getByRole("heading", {
      name: "Your account is at its business limit.",
    }),
  ).toBeVisible();
  const denied = await alice.evaluate(async () => {
    const r = await fetch("/api/v1/businesses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ name: "Fourth business" }),
    });
    return { status: r.status, body: await r.json() };
  });
  assert.equal(denied.status, 409);
  assert.match(denied.body.error, /BUSINESS_LIMIT_REACHED/);
  await alice.goto(base + `/b/${firstBusiness}/memory`);
  await expect(alice.locator(".memory-facts")).toContainText(
    "Refillable botanical soap",
  );
  await alice
    .getByLabel("Business", { exact: true })
    .selectOption(secondBusiness);
  await expect(
    alice.getByText("No approved brand profile yet.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    await alice.getByText("Refillable botanical soap", { exact: true }).count(),
    0,
  );
  await alice.getByRole("link", { name: "Canvas", exact: true }).click();
  await expect(
    alice.getByText("Confirm your brand profile first so each creative starts from approved facts.", { exact: false }),
  ).toBeVisible();
  await expect(alice.getByRole("button", {name:"Generate image",exact:true})).toBeDisabled();
  assert.equal(await alice.getByRole("button",{name:/Publish/}).count(),0);
  await alice.screenshot({
    path: "work/browser/v5-canvas-unapproved.png",
    fullPage: true,
  });
});

test("selected-business viewer sees only their business and cannot edit or open siblings", async () => {
  const context = await browser.newContext();
  bob = await context.newPage();
  await signup(bob, "browser-bob@example.test", "Sam Rivera");
  await signin(bob, "browser-bob@example.test");
  const business = (
      await admin.query("SELECT organization_id FROM app.brands WHERE id=$1", [
        secondBusiness,
      ])
    ).rows[0],
    user = (
      await admin.query('SELECT id FROM auth."user" WHERE email=$1', [
        "browser-bob@example.test",
      ])
    ).rows[0];
  await admin.query(
    "INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'viewer','selected')",
    [business.organization_id, user.id],
  );
  await admin.query(
    "INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [business.organization_id, secondBusiness, user.id],
  );
  await bob.goto(base + "/brands");
  await expect(bob.locator(".v5-business-card")).toHaveCount(1);
  await expect(bob.locator(".v5-business-card")).toContainText("Juniper Goods");
  await bob.goto(base + `/b/${firstBusiness}/memory`);
  await expect(
    bob.getByRole("heading", { name: "Business unavailable" }),
  ).toBeVisible();
  await bob.goto(base + `/b/${secondBusiness}/onboarding`);
  await expect(
    bob.getByRole("heading", { name: "Make it unmistakably yours." }),
  ).toBeVisible();
  assert.equal(
    await bob.getByRole("button", { name: "Add for review" }).count(),
    0,
  );
  assert.equal(await bob.getByLabel("Choose a brand file").count(), 0);
});

test("password recovery invokes actual identity flow and an expired session retains unsaved goals", async () => {
  await alice.goto(base + "/forgot-password");
  await alice.getByLabel("Email address").fill(email);
  await alice.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    alice.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await alice.goto(await emailLink(email, "Reset your Desvio password"));
  await alice.getByLabel("Password", { exact: true }).fill(password + "-new");
  await alice.getByRole("button", { name: "Save new password" }).click();
  await expect(
    alice.getByRole("heading", { name: "Password updated" }),
  ).toBeVisible();
  await signin(alice, email, password + "-new");
  await alice.goto(brandUrl);
  await alice
    .getByRole("button", { name: "Save & continue to goals →" })
    .click();
  await expect(alice.getByLabel("Topics or claims to avoid")).toBeVisible();
  await alice
    .getByLabel("Topics or claims to avoid")
    .fill("Never claim medical benefits");
  await admin.query(
    'DELETE FROM auth.session WHERE "userId"=(SELECT id FROM auth."user" WHERE email=$1)',
    [email],
  );
  await alice.getByRole("button", { name: "Save goals", exact: true }).click();
  await expect(alice.getByRole("alert").first()).toContainText(
    "Your session has ended",
  );
  await expect(alice.getByLabel("Topics or claims to avoid")).toHaveValue(
    "Never claim medical benefits",
  );
  const login = await alice.context().newPage();
  await signin(login, email, password + "-new");
  await login.close();
  await alice.getByRole("button", { name: "Save goals", exact: true }).click();
  await expect(alice.locator(".notice[role=alert]")).toHaveCount(0);
  await alice.reload();
  await expect(alice.getByLabel("Topics or claims to avoid")).toHaveValue(
    "Never claim medical benefits",
  );
});

test("warm business UI passes scoped desktop/mobile accessibility and contains no browser secrets", async () => {
  await alice.goto(base + "/brands");
  await expect(alice.locator(".v5-business-card")).toHaveCount(3);
  const desktop = await new AxeBuilder({ page: alice })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    desktop.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  await alice.setViewportSize({ width: 390, height: 844 });
  await alice.screenshot({
    path: "work/browser/v5-brands-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await alice.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await alice.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    alice.getByRole("link", { name: "Memory", exact: true }),
  ).toBeVisible();
  const mobile = await new AxeBuilder({ page: alice })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    mobile.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  for (const secret of [
    config.authSecret,
    config.mailEncryptionKey,
    config.storage.secretAccessKey,
  ])
    assert.ok(!(await alice.content()).includes(secret));
  assert.deepEqual(errors, []);
  await alice.goto(base + "/sign-in");
  await alice.keyboard.press("Tab");
  await expect(
    alice.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await alice.keyboard.press("Enter");
  for (let i = 0; i < 4; i++) {
    await alice.keyboard.press("Tab");
    if (
      await alice
        .getByLabel("Email address")
        .evaluate((el) => el === document.activeElement)
    )
      break;
  }
  await expect(alice.getByLabel("Email address")).toBeFocused();
});

test("saved AI recommendation pre-fills step three and user changes survive reload (explicit database fixture, no live model)", async () => {
  const list = await (
    await alice.request.get(base + "/api/v1/businesses")
  ).json();
  const target = list.businesses.find(
    (b) => b.id !== firstBusiness && b.id !== secondBusiness,
  );
  const user = (
    await admin.query('SELECT id FROM auth."user" WHERE email=$1', [email])
  ).rows[0];
  const fact = await alice.request.post(
    `${base}/api/v1/workspaces/${target.organization_id}/brands/${target.id}/brain/findings`,
    {
      headers: { origin: base, "idempotency-key": randomUUID() },
      data: {
        field: "offering",
        value: "Appointment software for dental practices",
      },
    },
  );
  assert.equal(fact.status(), 201);
  const chunk = (
    await admin.query("SELECT id FROM app.brand_chunks WHERE brand_id=$1", [
      target.id,
    ])
  ).rows[0];
  const job = randomUUID();
  await admin.query(
    "INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'brand.analyze','succeeded')",
    [job, target.organization_id, target.id, user.id],
  );
  await admin.query(
    "INSERT INTO app.onboarding_recommendations(id,organization_id,brand_id,job_id,review_revision,model,recommendation) VALUES($1,$2,$3,$4,1,$5,$6)",
    [
      randomUUID(),
      target.organization_id,
      target.id,
      job,
      "BROWSER FIXTURE ONLY",
      JSON.stringify({
        goal: "leads",
        audience: "Dental practices",
        channels: ["linkedin"],
        cadence: 4,
        reason: "Appointment software is offered to dental practices.",
        chunk_ids: [chunk.id],
      }),
    ],
  );
  await admin.query(
    "INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,result) VALUES($1,$2,$3,$4,'fixture',$5)",
    [
      job,
      target.organization_id,
      target.id,
      randomUUID(),
      JSON.stringify({
        visual_guidance: [
          {
            category: "composition",
            observation:
              "BROWSER FIXTURE: generous spacing around the headline.",
            creative_direction:
              "BROWSER FIXTURE: consider a spacious campaign layout.",
            image_ids: ["fixture:overview"],
          },
        ],
        visual_manifest: [
          {
            id: "fixture:overview",
            visual_id: "fixture",
            viewport: "desktop",
            view: "overview",
            website_url: "https://example.org/",
          },
        ],
      }),
    ],
  );
  await alice.goto(`${base}/b/${target.id}/onboarding`);
  await alice
    .getByText("Visual style & creative inspiration", { exact: true })
    .click();
  await expect(
    alice.getByText("BROWSER FIXTURE: generous spacing around the headline.", {
      exact: false,
    }).first(),
  ).toBeVisible();
  await expect(
    alice.getByRole("link", { name: "Source page", exact: true }),
  ).toHaveAttribute("href", "https://example.org/");
  const visualAccessibility = await new AxeBuilder({ page: alice })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  assert.deepEqual(
    visualAccessibility.violations.map((v) => v.id),
    [],
  );

  await alice
    .getByRole("button", { name: "Save & continue to goals →" })
    .click();
  await expect(
    alice.getByText("AI-prepared direction · yours to adjust"),
  ).toBeVisible();
  await expect(alice.getByLabel("Primary goal")).toHaveValue("leads");
  await expect(alice.getByLabel("Posts per week")).toHaveValue("4");
  await alice.getByText("Why these suggestions?", { exact: true }).click();
  await expect(
    alice.getByText("offering: Appointment software for dental practices", {
      exact: true,
    }),
  ).toBeVisible();
  await alice.getByLabel("Primary goal").selectOption("sales");
  await alice.getByRole("button", { name: "Save goals", exact: true }).click();
  await alice.reload();
  await expect(alice.getByLabel("Primary goal")).toHaveValue("sales");
  const denied = await bob.request.get(
    `${base}/api/v1/businesses/${target.id}/intake`,
  );
  assert.equal(denied.status(), 404);
  const accessibility = await new AxeBuilder({ page: alice })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations.map((v) => v.id),
    [],
  );
  await alice.getByRole("button",{name:"Back to brand review",exact:true}).click();
  const visual=alice.getByRole('article',{name:'Visual direction: composition'});
  await expect(visual.getByText('Needs review',{exact:true})).toBeVisible();
  await visual.getByRole('button',{name:'Edit',exact:true}).click();
  await visual.getByLabel('Edit visual composition').fill('Use spacious layouts with calm typography.');
  const visualRoute=`**/api/v1/workspaces/${target.organization_id}/brands/${target.id}/brain/visuals`;
  await alice.route(visualRoute,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary save failure'})}),{times:1});
  await visual.getByRole('button',{name:'Save visual correction'}).click();
  await expect(visual.getByRole('alert')).toBeVisible();
  await expect(visual.getByLabel('Edit visual composition')).toHaveValue('Use spacious layouts with calm typography.');
  await visual.getByRole('button',{name:'Save visual correction'}).click();
  await expect(visual.getByText('edited',{exact:true})).toBeVisible();
  await alice.reload();
  await expect(visual.getByText('Use spacious layouts with calm typography.',{exact:true})).toBeVisible();
  const brainURL=`${base}/api/v1/workspaces/${target.organization_id}/brands/${target.id}/brain`;
  // Complete the text evidence fixture; visual correction above uses the actual UI/API.
  for(const [field,value] of [['brand_name','Dental scheduling'],['audience','Dental practices']]){
    const added=await alice.request.post(brainURL+'/findings',{headers:{origin:base,'idempotency-key':randomUUID()},data:{field,value}});
    assert.equal(added.status(),201);
  }
  let draft=await (await alice.request.get(brainURL)).json();
  for(const f of draft.findings){const reviewed=await alice.request.patch(brainURL+'/findings/'+f.id,{headers:{origin:base},data:{revision:f.revision,decision:'correct'}});assert.equal(reviewed.status(),200);}
  const deniedVisual=await bob.request.patch(brainURL+'/visuals',{headers:{origin:base},data:{}});assert.equal(deniedVisual.status(),403);
  await alice.getByRole('button',{name:'Save & continue to goals →'}).click();
  await alice.getByRole('button',{name:'Confirm brand profile',exact:true}).click();
  await expect(alice.getByText('Your approved brand profile is saved.',{exact:true})).toBeVisible();
  await alice.getByRole('link',{name:'View brand memory',exact:true}).click();
  await expect(alice.getByText('Use spacious layouts with calm typography.',{exact:true})).toBeVisible();
  draft=await (await alice.request.get(brainURL)).json();
  assert.equal(draft.active.snapshot.facts.find(f=>f.field==='visual_direction_composition').value,'Use spacious layouts with calm typography.');
  await alice.screenshot({
    path: "work/browser/v5-ai-prefill.png",
    fullPage: true,
  });
});

test('retained visual styles stay editable without AI and unsaved edits survive replacement or empty background analysis',async()=>{
 const target=(await(await alice.request.get(base+'/api/v1/businesses')).json()).businesses.find(b=>b.id!==firstBusiness&&b.id!==secondBusiness);
 const brainURL=`${base}/api/v1/workspaces/${target.organization_id}/brands/${target.id}/brain`;
 const user=(await admin.query('SELECT id FROM auth."user" WHERE email=$1',[email])).rows[0];
 const prior=(await admin.query('SELECT result FROM app.intake_requests WHERE brand_id=$1 ORDER BY job_id LIMIT 1',[target.id])).rows[0].result;
 async function background(guidance){
  const id=randomUUID();
  await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status) VALUES($1,$2,$3,$4,'brand.analyze','succeeded')",[id,target.organization_id,target.id,user.id]);
  await admin.query("INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,result) VALUES($1,$2,$3,$4,'BROWSER FIXTURE',$5)",[id,target.organization_id,target.id,randomUUID(),JSON.stringify({visual_guidance:guidance,visual_manifest:prior.visual_manifest})]);
  await admin.query('UPDATE app.brand_review_state SET revision=revision+1 WHERE brand_id=$1',[target.id]);
 }
 await background([]);
 await alice.goto(`${base}/b/${target.id}/onboarding`);
 await alice.getByRole('button',{name:'Back to brand review',exact:true}).click();
 let card=alice.getByRole('article',{name:'Visual direction: composition',exact:true});
 await expect(card.getByText('Previously approved style · editable without another AI analysis')).toBeVisible();
 const count=(await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='brand.analyze'",[target.id])).rows[0].n;
 await card.getByRole('button',{name:'Edit',exact:true}).click();
 await card.getByLabel('Edit visual composition').fill('Strong typography with spacious margins.');
 const next=alice.getByRole('button',{name:'Save & continue to goals →'});
 await expect(next).toBeDisabled();
 let releaseSave;const saveGate=new Promise(resolve=>{releaseSave=resolve;});
 await alice.route(`**/api/v1/workspaces/${target.organization_id}/brands/${target.id}/brain/visuals`,async route=>{await saveGate;await route.continue();},{times:1});
 try{await card.getByRole('button',{name:'Save visual correction'}).click();await expect(card.getByLabel('Edit visual composition')).toHaveJSProperty('readOnly',true);await expect(next).toBeDisabled();}finally{releaseSave();}
 await expect(next).toBeEnabled();await next.click();
 await alice.getByRole('button',{name:'Confirm brand profile',exact:true}).click();
 await alice.getByRole('link',{name:'View brand memory',exact:true}).click();
 await expect(alice.getByText('Strong typography with spacious margins.',{exact:true})).toBeVisible();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='brand.analyze'",[target.id])).rows[0].n,count);
 await alice.getByRole('link',{name:'Review brand facts'}).click();
 await alice.getByRole('button',{name:'Back to brand review',exact:true}).click();
 card=alice.getByRole('article',{name:'Visual direction: composition',exact:true});
 await card.getByRole('button',{name:'Edit',exact:true}).click();
 await card.getByLabel('Edit visual composition').fill('Keep this unsaved correction.');
 await background([{...prior.visual_guidance[0],creative_direction:'BROWSER FIXTURE: new composition suggestion'}]);
 await alice.getByRole('button',{name:'Refresh evidence',exact:true}).click();
 let orphan=alice.getByRole('article',{name:'Unsaved visual direction: composition',exact:true});
 await expect(orphan.getByLabel('Edit visual composition')).toHaveValue('Keep this unsaved correction.');
 await expect(orphan.getByRole('button',{name:'Save visual correction'})).toBeDisabled();
 await expect(next).toBeDisabled();
 await orphan.getByRole('button',{name:'Discard edit & reload suggestion'}).click();
 await expect(orphan).toHaveCount(0);await expect(next).toBeEnabled();
 card=alice.getByRole('article',{name:'Visual direction: composition',exact:true});
 await card.getByRole('button',{name:'Edit',exact:true}).click();
 await card.getByLabel('Edit visual composition').fill('Keep this when new analysis has no suggestions.');
 await background([]);await alice.getByRole('button',{name:'Refresh evidence',exact:true}).click();
 orphan=alice.getByRole('article',{name:'Unsaved visual direction: composition',exact:true});
 await expect(orphan.getByLabel('Edit visual composition')).toHaveValue('Keep this when new analysis has no suggestions.');
 await expect(next).toBeDisabled();
 await alice.screenshot({path:'work/browser/v5-visual-draft-preserved.png',fullPage:true});
 await orphan.getByRole('button',{name:'Discard edit & reload suggestion'}).click();
 card=alice.getByRole('article',{name:'Visual direction: composition',exact:true});
 await card.getByRole('button',{name:'Remove style'}).click();
 await expect(card.getByText('Marked for removal',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Restore approved style'}).click();
 await expect(card.getByText('Strong typography with spacious margins.',{exact:true})).toBeVisible();
 const a11y=await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(a11y.violations.map(v=>v.id),[]);
 await card.getByRole('button',{name:'Remove style'}).click();await next.click();
 await alice.getByRole('button',{name:'Confirm brand profile',exact:true}).click();
 await expect(alice.getByText('Your approved brand profile is saved.',{exact:true})).toBeVisible();
 const approved=await(await alice.request.get(brainURL)).json();
 assert.ok(!approved.active.snapshot.facts.some(f=>f.field==='visual_direction_composition'));
});
