import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
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
  await expect(
    page.getByRole("heading", { name: "Every client. A clear space." }),
  ).toBeVisible();
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

test("browser signup, actual verification email, sign-in, client/brand creation and reload", async () => {
  await alice.goto(base + "/sign-up");
  await alice.screenshot({ path: "work/browser/signup.png", fullPage: true });
  await signup(alice, email, "Alex Morgan");
  await alice.getByLabel("Email address").fill(email);
  await alice.getByLabel("Password", { exact: true }).fill("wrong-password");
  await alice.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(alice.locator(".notice[role=alert]")).toContainText(
    "Email or password was not accepted",
  );
  await expect(alice.getByLabel("Email address")).toHaveValue(email);

  await signin(alice);
  await alice
    .getByRole("button", { name: "Create a client workspace", exact: true })
    .click();
  await alice.getByLabel("Client name").fill("Northstar Studio");
  await alice
    .getByRole("button", { name: "Create client", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Northstar Studio", exact: true }),
  ).toBeVisible();
  clientUrl = alice.url();
  await alice.getByRole("button", { name: "Add your first brand" }).click();
  await alice.getByLabel("Brand name").fill("Olive & Field");
  await alice.getByLabel("Website (optional)").fill("https://example.test");
  await alice
    .getByRole("button", { name: "Create brand", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Olive & Field", exact: true }),
  ).toBeVisible();
  brandUrl = alice.url();
  await alice.reload();
  await expect(
    alice.getByRole("heading", { name: "Olive & Field", exact: true }),
  ).toBeVisible();
  assert.equal(
    await alice
      .getByRole("button", { name: /Generate|Publish|Connect social/ })
      .count(),
    0,
  );
});

test("browser private upload, real validation, persisted reload and actual download", async () => {
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
  const download = await promise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), png);
  await alice.screenshot({
    path: "work/browser/brand-desktop.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  for (const secret of [
    config.authSecret,
    config.mailEncryptionKey,
    config.storage.secretAccessKey,
  ])
    assert.ok(!(await alice.content()).includes(secret));
});

test("network failure and stale edit retain entries until explicit recovery", async () => {
  await alice.getByRole("button", { name: "Edit details" }).click();
  await alice
    .getByLabel("Brand name", { exact: true })
    .fill("Olive & Field Collective");
  await alice.route("**/api/v1/workspaces/*/brands/*", (route) =>
    route.request().method() === "PATCH" ? route.abort() : route.continue(),
  );
  try {
    await alice.getByRole("button", { name: "Save details" }).click();
    await expect(alice.locator(".notice[role=alert]")).toContainText(
      "Your entries are still here",
    );
    await expect(alice.getByLabel("Brand name", { exact: true })).toHaveValue(
      "Olive & Field Collective",
    );
  } finally {
    await alice.unroute("**/api/v1/workspaces/*/brands/*");
  }
  await alice.getByRole("button", { name: "Save details" }).click();
  await expect(alice.getByText("Brand details saved.")).toBeVisible();
  const second = await alice.context().newPage();
  await second.goto(brandUrl);
  await second.getByRole("button", { name: "Edit details" }).click();
  await alice.getByRole("button", { name: "Edit details" }).click();
  await alice.getByLabel("Brand name", { exact: true }).fill("Olive & Field");
  await alice.getByRole("button", { name: "Save details" }).click();
  await expect(alice.getByText("Brand details saved.")).toBeVisible();
  await second
    .getByLabel("Brand name", { exact: true })
    .fill("Unsaved alternate");
  await second.getByRole("button", { name: "Save details" }).click();
  await expect(second.locator(".notice[role=alert]")).toContainText(
    "changed in another session",
  );
  await expect(second.getByLabel("Brand name", { exact: true })).toHaveValue(
    "Unsaved alternate",
  );
  await second.close();
});

test("real invitation survives sign-in, viewer controls and client isolation", async () => {
  const context = await browser.newContext();
  bob = await context.newPage();
  await signup(bob, "browser-bob@example.test", "Sam Rivera");
  await signin(bob, "browser-bob@example.test");
  await bob
    .getByRole("button", { name: "Create a client workspace", exact: true })
    .click();
  await bob.getByLabel("Client name").fill("Riverton Co");
  await bob.getByRole("button", { name: "Create client", exact: true }).click();
  await expect(
    bob.getByRole("heading", { name: "Riverton Co", exact: true }),
  ).toBeVisible();
  await bob.goto(brandUrl);
  await expect(
    bob.getByRole("heading", { name: "Workspace unavailable" }),
  ).toBeVisible();
  await alice.goto(clientUrl + "/team");
  await alice.getByLabel("Teammate’s email").fill("browser-bob@example.test");
  await alice.getByLabel("Workspace role").selectOption("viewer");
  await alice.getByRole("button", { name: "Send invitation" }).click();
  await expect(
    alice.getByText(
      "Invitation saved and email queued. Delivery status appears below.",
    ),
  ).toBeVisible();
  await drain();
  const invitation = smtp.messages.findLast(
    (m) =>
      m.to.value[0].address === "browser-bob@example.test" &&
      m.subject !== "Verify your Desvio email",
  );
  assert.ok(invitation);
  const link = messageLink(invitation).toString();
  await bob.goto(base);
  await bob.getByRole("button", { name: "Sign out" }).click();
  await expect(
    bob.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await bob.goto(link);
  await expect(
    bob.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await bob.getByLabel("Email address").fill("browser-bob@example.test");
  await bob.getByLabel("Password", { exact: true }).fill(password);
  await bob.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    bob.getByRole("button", { name: "Accept invitation" }),
  ).toBeEnabled();
  await bob.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    bob.getByRole("heading", { name: "Every client. A clear space." }),
  ).toBeVisible();
  await bob.goto(brandUrl);
  await expect(
    bob.getByRole("heading", { name: "Olive & Field", exact: true }),
  ).toBeVisible();
  assert.equal(
    await bob.getByRole("button", { name: "Edit details" }).count(),
    0,
  );
  assert.equal(await bob.getByLabel("Choose a brand file").count(), 0);
  await expect(bob.getByRole("button", { name: "Download" })).toBeVisible();
  const brandPath = new URL(brandUrl).pathname.replace(
    "/clients/",
    "/api/v1/workspaces/",
  );
  const denied = await bob.evaluate(
    async (path) =>
      (
        await fetch(path, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Forbidden", revision: 1 }),
        })
      ).status,
    brandPath,
  );
  assert.equal(denied, 403);
  await bob.getByLabel("Switch client").selectOption({ label: "Riverton Co" });
  await expect(
    bob.getByRole("heading", { name: "Riverton Co", exact: true }),
  ).toBeVisible();
  assert.equal(
    await bob.getByText("Olive & Field", { exact: true }).count(),
    0,
  );
});

test("new invitee can register, verify and accept without losing the invitation", async () => {
  const address = "browser-charlie@example.test";
  await alice.goto(clientUrl + "/team");
  await alice.getByLabel("Teammate’s email").fill(address);
  await alice.getByLabel("Workspace role").selectOption("editor");
  await alice.getByRole("button", { name: "Send invitation" }).click();
  await expect(
    alice.getByText(
      "Invitation saved and email queued. Delivery status appears below.",
    ),
  ).toBeVisible();
  const link = await emailLink(address, "Your Desvio client invitation");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await page
    .getByRole("link", { name: "Create an account", exact: true })
    .click();
  await page.getByLabel("Your name").fill("Jamie Lee");
  await page.getByLabel("Email address").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await page.goto(await emailLink(address, "Verify your Desvio email"));
  await page.getByLabel("Email address").fill(address);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Accept invitation" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(
    page.getByRole("heading", { name: "Every client. A clear space." }),
  ).toBeVisible();
  await page.goto(brandUrl);
  await expect(page.getByLabel("Choose a brand file")).toBeVisible();
  await context.close();
});

test("password recovery uses actual queued email and accepts the new password", async () => {
  await alice.goto(base + "/forgot-password");
  await alice.getByLabel("Email address").fill(email);
  await alice.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    alice.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  const link = await emailLink(email, "Reset your Desvio password");
  await alice.goto(link);
  await expect(
    alice.getByRole("heading", { name: "Choose a new password." }),
  ).toBeVisible();
  await alice.getByLabel("Password", { exact: true }).fill(password + "-new");
  await alice.getByRole("button", { name: "Save new password" }).click();
  await expect(
    alice.getByRole("heading", { name: "Password updated" }),
  ).toBeVisible();
  await signin(alice, email, password + "-new");
});

test("expired session preserves the draft and reauthentication can resume saving", async () => {
  await alice.goto(brandUrl);
  await alice.getByRole("button", { name: "Edit details" }).click();
  await alice.getByLabel("Brand name", { exact: true }).fill("Recovered draft");
  await admin.query(
    'DELETE FROM auth.session WHERE "userId"=(SELECT id FROM auth."user" WHERE email=$1)',
    [email],
  );
  await alice.getByRole("button", { name: "Save details" }).click();
  await expect(
    alice.locator(".brand-details .notice[role=alert]"),
  ).toContainText("Your session has ended");
  await expect(alice.getByLabel("Brand name", { exact: true })).toHaveValue(
    "Recovered draft",
  );
  const login = await alice.context().newPage();
  await signin(login, email, password + "-new");
  await login.close();
  await alice.getByRole("button", { name: "Save details" }).click();
  await expect(alice.getByText("Brand details saved.")).toBeVisible();
  await alice.getByRole("button", { name: "Edit details" }).click();
  await alice.getByLabel("Brand name", { exact: true }).fill("Olive & Field");
  await alice.getByRole("button", { name: "Save details" }).click();
  await expect(alice.getByText("Brand details saved.")).toBeVisible();
});

test("mobile layout, keyboard access, accessible names/contrast and no fake provider controls", async () => {
  await alice.goto(brandUrl);
  await expect(
    alice.getByRole("heading", { name: "Olive & Field", exact: true }),
  ).toBeVisible();
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
    path: "work/browser/brand-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await alice.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const mobile = await new AxeBuilder({ page: alice })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    mobile.violations.map((v) => v.id),
    [],
  );
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
  const auth = await new AxeBuilder({ page: alice })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    auth.violations.map((v) => v.id),
    [],
  );
  assert.deepEqual(errors, []);
});
