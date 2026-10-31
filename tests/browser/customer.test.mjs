import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { ObjectStore, digest } from "../../dist/object-store.js";
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
  await expect(page.getByRole("heading", { name: /^(Add your first business|Choose a business|Your content, at a glance\.)$/ })).toBeVisible();
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
  // Drain mocked network handlers before disposing their request contexts.
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) await page.unrouteAll({behavior:"wait"});
    await context.unrouteAll({behavior:"wait"});
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
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Does this feel like you?" }),
  ).toBeVisible();
  return alice.url().split("/b/")[1].split("/")[0];
}
async function addFact(field, value) {
  const manual = alice.locator("details").filter({has: alice.getByText("Add a detail the website does not cover", {exact:true})});
  if (!(await manual.evaluate(el => el.open))) await manual.locator("summary").click();
  await alice.getByLabel("Brand field", { exact: true }).selectOption(field);
  await alice.getByLabel("Fact", { exact: true }).fill(value);
  await alice
    .getByRole("button", { name: "Add for review", exact: true })
    .click();
  const choices=alice.getByLabel(`Choose your ${field.replaceAll('_',' ')} description`,{exact:true});
  // Adding an alternative must not silently replace the currently selected description.
  await expect(async()=>{
    if(await choices.count()){
      const option=choices.locator('option').filter({hasText:value.slice(0,90)});
      if(await option.count())await choices.selectOption(await option.getAttribute('value'));
    }
    await expect(alice.locator('.finding-card').filter({hasText:value})).toBeVisible();
  }).toPass({timeout:8000});
}

test("V5 signup and real email verification lead to zero businesses and exact navigation", async () => {
  await signup(alice, email, "Alex Morgan");
  await signin(alice);
  await expect(alice.getByRole('combobox',{name:'Business',exact:true})).toHaveCount(0);
  await expect(alice.locator('.workspace-context')).toHaveText('Your workspace');
  await expect(alice.getByRole('link',{name:'Create',exact:true})).toHaveCount(0);
  await expect(
    alice.getByRole("link", { name: "Add business", exact: true }),
  ).toBeVisible();
  assert.deepEqual(await alice.locator("#business-nav a").allTextContents(), ['Home','Calendar','Campaigns','Approvals','Brand Kit','Content Preferences','Integrations','Learnings','Insights','Archived Posts','Brands','Team','Billing','Profile']);  await alice.goto(base + "/brands");
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
  assert.deepEqual(colors, { paper: "#ffffff", ink: "#191919" });
  await alice.goto(base + '/brands/new');
  await alice.getByLabel('Business name', {exact:true}).fill('URL entry check');
  const submitted=[];
  const intercept=async route=>{if(route.request().method()==='POST'){submitted.push(route.request().postDataJSON());return route.fulfill({status:422,json:{message:'Validation fixture'}});}return route.continue();};
  await alice.route('**/api/v1/businesses',intercept);
  for(const [input,normalized] of [['www.samsung.com','https://www.samsung.com'],[' samsung.com/about ','https://samsung.com/about'],['https://www.samsung.com/','https://www.samsung.com/']]){
    await alice.getByLabel('Website (optional)',{exact:true}).fill(input);
    await alice.getByRole('button',{name:'Continue',exact:true}).click();
    await expect.poll(()=>submitted.at(-1)?.website).toBe(normalized);
  }
  await alice.unroute('**/api/v1/businesses',intercept);
  await alice.getByLabel('Business name',{exact:true}).fill('');
  await alice.getByLabel('Website (optional)',{exact:true}).fill('');

});

test("three-step manual fallback saves evidence, corrections, goals and immutable brand memory", async () => {
  firstBusiness = await createBusiness("Olive & Field");
  brandUrl = base + `/b/${firstBusiness}/onboarding`;
  await alice.reload();
  await expect(
    alice.getByRole("heading", { name: "Does this feel like you?" }),
  ).toBeVisible();
  await addFact("brand_name", "Olive & Field");
  await addFact("products", "Refillable botanical soap");
  await addFact("products", "Botanical soap refills for independent stores");
  const products=alice.locator('.finding-card').filter({has:alice.getByRole('heading',{name:'products',exact:true})});
  await expect(products).toHaveCount(1);
  await products.getByRole('button',{name:'Correct',exact:true}).click();
  await expect(products.getByRole('button',{name:'Correct',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(alice.getByLabel('Choose your products description')).toHaveCount(0);
  const offering=alice.locator('.missing-brand-detail').filter({has:alice.getByRole('heading',{name:'offering',exact:true})});
  await expect(offering.getByRole('textbox')).not.toHaveValue('');
  await offering.getByRole('textbox').fill('Refillable botanical soap');
  await offering.getByRole('button',{name:'Add to my profile'}).click();
  await expect(offering).toHaveCount(0);
  await addFact("audience", "Independent homeware shops");
  for (const card of await alice.locator(".finding-card").all())
    await card.getByRole("button", { name: "Correct", exact: true }).click();
  await expect(alice.getByText("Needs review", { exact: true })).toHaveCount(0);
  await expect(alice.getByRole("button", {name:"Correct",exact:true,pressed:true})).toHaveCount(4);
  await alice
    .getByRole("button", { name: "Confirm details & continue" })
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
  await alice.getByLabel("Time zone", { exact: true }).fill("Kuala Lumpur");
  await alice.getByRole("button", { name: "Kuala Lumpur Asia/Kuala Lumpur", exact: true }).click();
  await expect(alice.locator(".time-zone-selection")).toContainText("Asia/Kuala Lumpur");
  await alice.getByRole("button", { name: "Save goals", exact: true }).click();
  await alice.reload();
  await expect(alice.getByLabel("Primary goal")).toHaveValue("leads");
  await alice.getByRole("button", { name: "Save brand without a plan" }).click();
  await expect(
    alice.getByRole("heading", { name: "Your brand is ready." }),
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
  await alice.getByText('Sources & advanced options',{exact:true}).click();
  await alice.getByText('View sources and website captures',{exact:true}).click();
  await alice.getByRole('button',{name:'Refresh image sources',exact:true}).click();
  await alice.getByText('Approve images for future creatives',{exact:true}).click();
  const source=alice.getByRole('region',{name:'Approve reference: Uploaded product photo',exact:true});
  await source.getByRole('button',{name:'Inspect Uploaded product photo',exact:true}).click();await expect(source.getByRole('img',{name:'Uploaded product photo',exact:true})).toBeVisible();
  await source.getByLabel('Use part of this image', {exact:true}).check();
  await source.getByLabel('Crop width',{exact:true}).fill('32');await source.getByLabel('Crop height',{exact:true}).fill('32');
  await source.getByRole('button',{name:'Preview selected crop',exact:true}).click();await expect(source.getByRole('img',{name:'Selected reference crop',exact:true})).toBeVisible();
  await source.getByLabel('Reference name',{exact:true}).fill('Product photo crop');
  await expect(source.getByRole('button',{name:'Approve image reference',exact:true})).toBeDisabled();
  await source.getByLabel('I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.',{exact:true}).check();
  await source.getByRole('button',{name:'Approve image reference',exact:true}).click();
  await expect(alice.getByText('Product photo crop',{exact:true})).toBeVisible();
  await alice.getByRole('button',{name:'Preview Product photo crop',exact:true}).click();await expect(alice.getByRole('img',{name:'Product photo crop',exact:true})).toBeVisible();
  const references=await alice.request.get(base+brandUrl.replace(base,'').replace('/b/','/api/v1/businesses/').replace('/onboarding','')+'/canvas/references');assert.equal(references.status(),200);assert.deepEqual((await references.json()).references.find(r=>r.label==='Product photo crop').crop,{left:0,top:0,width:32,height:32});
  await alice.screenshot({path:'work/browser/product-photo-crop.png',fullPage:true});

  assert.deepEqual(errors, []);
});

test("failed and stale fact edits preserve entered corrections and require explicit recovery", async () => {
  const card = alice
    .locator(".finding-card")
    .filter({ has: alice.getByRole("heading", { name: "offering", exact: true }) });
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

test('Brand Kit edits persist and approval excludes unsaved drafts',async()=>{
 await alice.goto(base+`/b/${firstBusiness}/brand-kit`);
 await expect(alice.getByRole('heading',{name:'Brand Kit',exact:true})).toBeVisible();
 await expect(alice.getByRole('heading',{name:'Media Library',exact:true})).toBeVisible();
 await alice.getByRole('button',{name:'Brand Profile',exact:true}).click();
 const offering=alice.locator('.finding-card').filter({has:alice.getByRole('heading',{name:'offering',exact:true})});
 await offering.getByRole('button',{name:'Edit',exact:true}).click();
 await offering.getByLabel('Edit offering').fill('Botanical refill packs for stores');
 await alice.getByRole('button',{name:'Save approved brand',exact:true}).click();
 await expect(alice.getByRole('alert').filter({hasText:'Save or cancel your open edits'})).toBeVisible();
 const delayedCorrection=async route=>{if(route.request().method()==='PATCH'){await setTimeout(500);}await route.continue();};
 await alice.route('**/brain/findings/*',delayedCorrection);
 await offering.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(alice.getByRole('button',{name:'Save approved brand',exact:true})).toBeDisabled();
 await expect(offering.getByRole('button',{name:'Save correction',exact:true})).not.toBeVisible();
 await alice.unroute('**/brain/findings/*',delayedCorrection);
 await expect(offering.getByText('Botanical refill packs for stores',{exact:true})).toBeVisible();
 await alice.getByRole('button',{name:'Save approved brand',exact:true}).click();
 await expect(alice.getByRole('status').filter({hasText:'Your approved brand is saved.'})).toBeVisible();
 await alice.reload();
 await expect(alice.getByText('Botanical refill packs for stores',{exact:true})).toBeVisible();
 await alice.getByRole('button',{name:'Brand Voice',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'Your voice',exact:true})).toBeVisible();
 await expect(alice.getByRole('heading',{name:'offering',exact:true})).toHaveCount(0);
 await alice.getByRole('button',{name:'Brand Style',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'Colors and typography',exact:true})).toBeVisible();
 await alice.getByText('Add a detail the website does not cover',{exact:true}).click();
 await alice.getByLabel('Brand field',{exact:true}).selectOption('fonts');
 await alice.getByRole('button',{name:'Modern Aa DM Sans',exact:true}).click();
 await alice.getByRole('button',{name:'Add for review',exact:true}).click();
 const fonts=alice.locator('.finding-card').filter({has:alice.getByRole('heading',{name:'fonts',exact:true})});
 await expect(fonts.getByLabel('Typography preview',{exact:true})).toBeVisible();
 await fonts.getByRole('button',{name:'Edit',exact:true}).click();
 await fonts.getByRole('button',{name:'Classic Aa DM Serif Display',exact:true}).click();
 await fonts.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(fonts.getByLabel('Edit fonts',{exact:true})).toHaveCount(0);
 await alice.getByRole('button',{name:'Save approved brand',exact:true}).click();
 await expect(alice.getByRole('status').filter({hasText:'Your approved brand is saved.'})).toBeVisible();
 await alice.reload();
 await expect(fonts.getByText('Headlines: DM Serif Display, weight 400. Body: DM Sans, weight 400.',{exact:true})).toBeVisible();
 await expect(fonts.locator('.brand-type-live strong')).toHaveCSS('font-family','"DM Serif Display"');
 await alice.screenshot({path:'work/browser/brand-kit-typography.png',fullPage:true});
 await alice.setViewportSize({width:390,height:844});
 assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.setViewportSize({width:1440,height:1000});
 await alice.getByRole('button',{name:'Media Library',exact:true}).click();
 await expect(alice.locator('.brand-media-library')).toBeVisible();
 await expect(alice.getByRole('img',{name:'Product photo crop',exact:true})).toBeVisible();
 await alice.getByRole('button',{name:'+ Add media',exact:true}).click();await expect(alice.getByLabel('Choose a product photo',{exact:true})).toBeVisible();await alice.getByRole('button',{name:'Close upload',exact:true}).click();
 await alice.getByRole('button',{name:'To review',exact:true}).click();await expect(alice.getByRole('heading',{name:'All caught up',exact:true})).toBeVisible();await alice.getByRole('button',{name:'Approved',exact:true}).click();await alice.getByRole('searchbox',{name:'Search media',exact:true}).fill('no match');await expect(alice.getByRole('heading',{name:'No matching images',exact:true})).toBeVisible();await alice.getByRole('searchbox',{name:'Search media',exact:true}).fill('');await alice.getByRole('button',{name:'All media',exact:true}).click();
 await alice.locator('.reference-list li').filter({has:alice.getByRole('img',{name:'Product photo crop',exact:true})}).getByText('Approved',{exact:true}).click();
 await alice.getByRole('button',{name:'Remove approval for Product photo crop',exact:true}).click();
 await expect(alice.locator('.brand-media-tile')).toHaveCount(1);
 await expect(alice.locator('.brand-media-tile summary img')).toBeVisible();
 await alice.locator('.brand-media-tile summary').click();
 const mediaReview=alice.getByRole('region',{name:'Approve reference: Uploaded product photo',exact:true});
 await expect(mediaReview.getByRole('button',{name:'Approve image reference',exact:true})).toBeDisabled();
 await mediaReview.getByLabel('I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.',{exact:true}).check();
 await mediaReview.getByRole('button',{name:'Approve image reference',exact:true}).click();
 await expect(alice.locator('.brand-media-tile')).toHaveCount(0);
 await expect(alice.getByRole('img',{name:'Uploaded product photo',exact:true})).toBeVisible();
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);

 await alice.screenshot({path:'work/browser/brand-kit-media-desktop.png',fullPage:true});
 await alice.setViewportSize({width:390,height:844});
 assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.screenshot({path:'work/browser/brand-kit-media-mobile.png',fullPage:true});
 await alice.setViewportSize({width:1440,height:1000});
 await alice.getByRole('button',{name:'Source Materials',exact:true}).click();
 await expect(alice.getByLabel('Choose a brand file',{exact:true}).first()).toBeVisible();
 await expect(alice.getByText('brand-reference.png',{exact:true}).first()).toBeVisible();
 await alice.getByRole('button',{name:'Brand Profile',exact:true}).click();
 await expect(alice.getByText('Botanical refill packs for stores',{exact:true})).toBeVisible();
});

test("three saved businesses, server fourth rejection, selector isolation and campaign brand prerequisite", async () => {
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
    "Botanical refill packs for stores",
  );
  await alice
    .getByLabel("Business", { exact: true })
    .selectOption(secondBusiness);
  await expect(
    alice.getByText("Confirm your brand profile to start building its knowledge.", { exact: false }),
  ).toBeVisible();
  assert.equal(
    await alice.getByText("Botanical refill packs for stores", { exact: true }).count(),
    0,
  );
  await alice.goto(base + `/b/${secondBusiness}/canvas`);
  await expect(alice).toHaveURL(base + `/b/${secondBusiness}/campaigns`);
  await expect(alice.getByRole('link', {name:'Canvas',exact:true})).toHaveCount(0);
  await alice.getByRole('link', {name:'Plan a campaign →',exact:true}).click();
  await expect(alice.getByRole('heading', {name:'Confirm your brand first',exact:true})).toBeVisible();
  await expect(alice.getByRole('link', {name:'Open brand setup',exact:true})).toHaveAttribute('href', `/b/${secondBusiness}/onboarding`);
  await expect(alice.getByRole('button', {name:'Create campaign plan',exact:true})).toHaveCount(0);
  assert.equal(await alice.getByRole('button',{name:/Publish/}).count(),0);
  const canvasAccessibility=(await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations;
  assert.deepEqual(canvasAccessibility.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],JSON.stringify(canvasAccessibility.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))));
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
    bob.getByRole("heading", { name: "Does this feel like you?" }),
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
    .getByRole("button", { name: "Confirm details & continue" })
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
  await expect(alice.getByRole("button", {name:"Save goals",exact:true})).toBeEnabled();
  await expect(alice.locator(".notice[role=alert]")).toHaveCount(0);
  await alice.reload();
  await expect(alice.getByLabel("Topics or claims to avoid")).toHaveValue(
    "Never claim medical benefits",
  );
});

test("neutral business UI passes scoped desktop/mobile accessibility and contains no browser secrets", async () => {
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
    alice.getByRole("link", { name: "Learnings", exact: true }),
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
  // Explicit browser fixture: actual PDF/page pixels in private storage. The
  // complete scanner/extraction/analysis path is covered by foundation tests.
  execFileSync('uv',['run','--project','apps/ingestion','--frozen','--group','test','python','scripts/make_document_fixtures.py'],{stdio:'pipe'});
  execFileSync('uv',['run','--project','apps/ingestion','--frozen','python','-c',"import sys; from pathlib import Path; sys.path.insert(0,'apps/ingestion'); from document_visuals import render_pdf; Path('work/document-fixtures/browser-page.jpg').write_bytes(next(render_pdf(Path('work/document-fixtures/guidelines.pdf').read_bytes()))['bytes'])"],{stdio:'pipe'});
  const documentBytes=await readFile('work/document-fixtures/guidelines.pdf'),pageBytes=await readFile('work/document-fixtures/browser-page.jpg');
  const documentId=randomUUID(),sourceId=randomUUID(),documentJob=randomUUID(),visualId=randomUUID();
  const documentKey=`evidence/${target.organization_id}/${target.id}/documents/${documentId}/original/${digest(documentBytes)}`;
  const pageKey=`evidence/${target.organization_id}/${target.id}/documents/${documentId}/page-1/${digest(pageBytes)}`;
  const objectStore=new ObjectStore(config.storage);
  try {await objectStore.persist(documentKey,documentBytes,'application/pdf',digest(documentBytes));await objectStore.persist(pageKey,pageBytes,'image/jpeg',digest(pageBytes));}finally{objectStore.close();}
  const dimensions=await sharp(pageBytes).metadata();
  await admin.query("INSERT INTO app.assets(id,organization_id,brand_id,created_by,filename,content_type,expected_bytes,sha256,quarantine_key,canonical_key,state) VALUES($1,$2,$3,$4,'BROWSER-FIXTURE.pdf','application/pdf',$5,$6,$7,$8,'ready')",[documentId,target.organization_id,target.id,user.id,documentBytes.length,digest(documentBytes),documentKey+'-quarantine',documentKey]);
  await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,asset_id,requested_by,kind,status) VALUES($1,$2,$3,$4,$5,'document.extract','succeeded')",[documentJob,target.organization_id,target.id,documentId,user.id]);
  await admin.query("INSERT INTO app.brand_sources(id,organization_id,brand_id,asset_id,kind,sha256,parser_version,coverage) VALUES($1,$2,$3,$4,'document',$5,'BROWSER-FIXTURE',$6)",[sourceId,target.organization_id,target.id,documentId,digest(documentBytes),JSON.stringify({type:'BROWSER FIXTURE',pages:2,visual_pages:[1]})]);
  await admin.query("INSERT INTO app.document_visuals(id,organization_id,brand_id,source_id,job_id,page,parser_version,object_key,sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,1,'BROWSER-FIXTURE',$6,$7,$8,$9,$10)",[visualId,target.organization_id,target.id,sourceId,documentJob,pageKey,digest(pageBytes),pageBytes.length,dimensions.width,dimensions.height]);
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
        reason: `Appointment software is offered to dental practices. Cited: ${chunk.id}.`,
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
            image_ids: ["fixture:overview",visualId+":overview"],
          },
        ],
        visual_manifest: [
          {id:visualId+":overview",visual_id:visualId,source_id:sourceId,document_page:1,document_sha256:digest(documentBytes),source_sha256:digest(pageBytes),viewport:'document',view:'overview'},
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
  await alice.getByText("Sources & advanced options", {exact:true}).click();
  await alice.getByText("View sources and website captures", {exact:true}).click();
  await alice.getByText(/Explore your brand’s visual sources/).click();
  await alice.getByRole('button',{name:'View document page 1',exact:true}).click();
  await expect(alice.getByAltText('Uploaded guideline page 1')).toBeVisible();
  await expect.poll(()=>alice.getByAltText('Uploaded guideline page 1').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await alice.getByText('Approve images for future creatives',{exact:true}).click();
  const referenceApproval=alice.getByRole('region',{name:'Approve reference: Document page 1'});
  await expect(referenceApproval.getByRole('button',{name:'Approve image reference'})).toBeDisabled();
  await referenceApproval.getByLabel('Reference name',{exact:true}).fill('My guideline reference');
  await referenceApproval.getByLabel('I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.',{exact:true}).check();
  await referenceApproval.getByRole('button',{name:'Approve image reference'}).click();
  await expect(alice.getByRole('button',{name:'Remove approval for My guideline reference'})).toBeVisible();
  const privatePreview=`${base}/api/v1/businesses/${target.id}/visuals/${visualId}`;
  assert.equal((await bob.request.get(privatePreview)).status(),404);
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
    visualAccessibility.violations.map((v) => ({id:v.id,nodes:v.nodes.map(n=>n.target)})),
    [],
  );

  await addFact('brand_name','Dental scheduling');
  const audienceCard=alice.locator('.missing-brand-detail').filter({has:alice.getByLabel('Who are your customers?')});
  await expect(audienceCard.getByLabel('Who are your customers?')).toHaveValue('Dental practices');
  await audienceCard.getByRole('button',{name:'Add to my profile'}).click();
  await expect(audienceCard).toHaveCount(0);
  await alice
    .getByRole("button", { name: "Confirm details & continue" })
    .click();
  await expect(
    alice.getByText("Your brand changed. Review your suggested direction."),
  ).toBeVisible();
  await expect(alice.getByLabel("Primary goal")).toHaveValue("leads");
  await expect(alice.getByLabel("Posts per week")).toHaveValue("4");
  await expect(alice.getByText('Why these suggestions?',{exact:true})).toHaveCount(0);
  await expect(alice.locator('.availability-card')).not.toContainText(chunk.id);
  await expect(alice.locator('.availability-card')).toContainText('Appointment software is offered to dental practices.');
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
  await visual.getByText('Supporting visual evidence',{exact:true}).click();
  await visual.getByRole('button',{name:'View document page 1',exact:true}).click();
  await expect(visual.getByAltText('Source guideline page 1')).toBeVisible();
  await expect.poll(()=>visual.getByAltText('Source guideline page 1').evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await expect(visual.getByText('correct',{exact:true})).toBeVisible();
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
  let draft=await (await alice.request.get(brainURL)).json();
  const deniedVisual=await bob.request.patch(brainURL+'/visuals',{headers:{origin:base},data:{}});assert.equal(deniedVisual.status(),403);
  await alice.getByRole('button',{name:'Confirm details & continue'}).click();
  await alice.getByRole('button',{name:'Save brand without a plan',exact:true}).click();
  await expect(alice.getByText('Your approved brand profile is saved.',{exact:true})).toBeVisible();
  await alice.getByRole('link',{name:'View brand memory',exact:true}).click();
  await expect(alice.getByText('Use spacious layouts with calm typography.',{exact:true})).toBeVisible();
  draft=await (await alice.request.get(brainURL)).json();
  assert.equal(draft.active.snapshot.facts.find(f=>f.field==='visual_direction_composition').value,'Use spacious layouts with calm typography.');
  const approvedFact=draft.active.snapshot.facts.find(f=>f.field==='offering'),sourceRoute=`**/brain/sources/${approvedFact.source_id}`;
  await alice.route(sourceRoute,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Source temporarily unavailable'})}),{times:1});
  await alice.getByText('Evidence for offering',{exact:true}).click();await expect(alice.getByRole('button',{name:'Retry source evidence',exact:true})).toBeVisible();
  await alice.getByRole('button',{name:'Retry source evidence',exact:true}).click();await expect(alice.locator('blockquote').filter({hasText:'offering: '+approvedFact.value})).toBeVisible();
  await alice.getByText('Evidence for visual direction composition',{exact:true}).click();await expect(alice.getByText(/Approved visual interpretation with/)).toBeVisible();
  await alice.getByRole('button',{name:'Sources',exact:true}).click();
  const savedSources=alice.getByRole('region',{name:'Saved brand sources',exact:true});await savedSources.getByText(/Browse saved sources/).click();await expect(savedSources.getByRole('listitem')).toHaveCount(draft.sources.length);
  assert.deepEqual((await new AxeBuilder({page:alice}).analyze()).violations,[]);

  await alice.screenshot({
    path: "work/browser/v5-ai-prefill.png",
    fullPage: true,
  });
  const starts=new Date().toISOString().slice(0,10);
  const planResponse=await alice.request.post(`${base}/api/v1/businesses/${target.id}/content-plans`,{headers:{origin:base,'idempotency-key':randomUUID()},data:{title:'Reference selection fixture',objective:'Verify selected approved references',starts_on:starts,timezone:'UTC',slots:[{channel:'instagram',format:'static',planned_at:starts+'T12:00:00Z',brief:'Reference selection draft'}]}});
  assert.equal(planResponse.status(),201,await planResponse.text());
  await alice.goto(`${base}/b/${target.id}/campaigns`);
  await alice.getByRole('button',{name:'＋ New Post',exact:true}).click();
  const composer=alice.getByRole('dialog',{name:'New Post',exact:true});
  await composer.getByRole('button',{name:'Media library',exact:true}).click();
  await composer.getByRole('checkbox',{name:'My guideline reference',exact:true}).check();
  await expect(composer.getByRole('checkbox',{name:'My guideline reference',exact:true})).toBeChecked();
  await expect.poll(()=>composer.locator('.campaign-reference-selected').getByAltText('My guideline reference',{exact:true}).evaluate(image=>image.naturalWidth)).toBeGreaterThan(0);
  await alice.screenshot({path:'work/browser/brand-reference-selection.png',fullPage:true});
  await composer.getByRole('button',{name:'Close new post',exact:true}).click();
  await alice.goto(`${base}/b/${target.id}/brand-kit`);
  await alice.getByRole('button',{name:'Media Library',exact:true}).click();
  await alice.locator('.reference-list li').filter({has:alice.getByRole('img',{name:'My guideline reference',exact:true})}).getByText('Approved',{exact:true}).click();
  await alice.getByRole('button',{name:'Remove approval for My guideline reference',exact:true}).click();
  await expect(alice.getByRole('button',{name:'Remove approval for My guideline reference',exact:true})).toHaveCount(0);
  await alice.goto(`${base}/b/${target.id}/campaigns`);
  await alice.getByRole('button',{name:'＋ New Post',exact:true}).click();
  await composer.getByRole('button',{name:'Media library',exact:true}).click();
  await expect(composer.getByRole('checkbox',{name:'My guideline reference',exact:true})).toHaveCount(0);
  await composer.getByRole('button',{name:'Close new post',exact:true}).click();

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
 const next=alice.getByRole('button',{name:'Confirm details & continue'});
 await expect(next).toBeDisabled();
 let releaseSave;const saveGate=new Promise(resolve=>{releaseSave=resolve;});
 await alice.route(`**/api/v1/workspaces/${target.organization_id}/brands/${target.id}/brain/visuals`,async route=>{await saveGate;await route.continue();},{times:1});
 try{await card.getByRole('button',{name:'Save visual correction'}).click();await expect(card.getByLabel('Edit visual composition')).toHaveJSProperty('readOnly',true);await expect(next).toBeDisabled();}finally{releaseSave();}
 await expect(next).toBeEnabled();await next.click();
 await alice.getByRole('button',{name:'Save brand without a plan',exact:true}).click();
 await alice.getByRole('link',{name:'View brand memory',exact:true}).click();
 await expect(alice.getByText('Strong typography with spacious margins.',{exact:true})).toBeVisible();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='brand.analyze'",[target.id])).rows[0].n,count);
 await alice.getByRole('link',{name:'Edit brand facts',exact:true}).click();
 await alice.getByRole('button',{name:'Back to brand review',exact:true}).click();
 card=alice.getByRole('article',{name:'Visual direction: composition',exact:true});
 await card.getByRole('button',{name:'Edit',exact:true}).click();
 await card.getByLabel('Edit visual composition').fill('Keep this unsaved correction.');
 await background([{...prior.visual_guidance[0],creative_direction:'BROWSER FIXTURE: new composition suggestion'}]);
 await alice.getByRole('button',{name:'Refresh profile',exact:true}).click();
 let orphan=alice.getByRole('article',{name:'Unsaved visual direction: composition',exact:true});
 await expect(orphan.getByLabel('Edit visual composition')).toHaveValue('Keep this unsaved correction.');
 await expect(orphan.getByRole('button',{name:'Save visual correction'})).toBeDisabled();
 await expect(next).toBeDisabled();
 await orphan.getByRole('button',{name:'Discard edit & reload suggestion'}).click();
 await expect(orphan).toHaveCount(0);await expect(next).toBeEnabled();
 card=alice.getByRole('article',{name:'Visual direction: composition',exact:true});
 await card.getByRole('button',{name:'Edit',exact:true}).click();
 await card.getByLabel('Edit visual composition').fill('Keep this when new analysis has no suggestions.');
 await background([]);await alice.getByRole('button',{name:'Refresh profile',exact:true}).click();
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
 await alice.getByRole('button',{name:'Save brand without a plan',exact:true}).click();
 await expect(alice.getByText('Your approved brand profile is saved.',{exact:true})).toBeVisible();
 const approved=await(await alice.request.get(brainURL)).json();
 assert.ok(!approved.active.snapshot.facts.some(f=>f.field==='visual_direction_composition'));
});

test('business Team invites through real email, accepts selected access, changes roles and removes only that business',async()=>{
 await alice.goto(base+`/b/${firstBusiness}/team`);await expect(alice.getByRole('heading',{name:'Team',exact:true})).toBeVisible();
 await alice.getByLabel('Teammate’s email').fill('browser-bob@example.test');await alice.getByLabel('Business role',{exact:true}).selectOption('viewer');await alice.getByRole('button',{name:'Send invitation',exact:true}).click();
 await expect(alice.getByText('Invitation saved and email queued.',{exact:false})).toBeVisible();const link=await emailLink('browser-bob@example.test','Your Desvio client invitation');
 await bob.goto(link);await bob.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect(bob.getByRole('heading',{name:/^(Add your first business|Choose a business|Your content, at a glance\.)$/})).toBeVisible();await bob.goto(base+'/brands');await expect(bob.locator('.v5-business-card')).toHaveCount(2);
 await alice.getByRole('button',{name:'Refresh team',exact:true}).click();await alice.getByRole('button',{name:'Manage Sam Rivera',exact:true}).click();await alice.getByLabel('Role for Sam Rivera').selectOption('editor');await alice.getByRole('button',{name:'Save role',exact:true}).click();await expect(alice.getByText('Business role saved.',{exact:true})).toBeVisible();
 await alice.reload();await expect(alice.getByRole('region',{name:'People with access'}).getByText('editor',{exact:true})).toBeVisible();assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);await alice.screenshot({path:'work/browser/business-team-desktop.png',fullPage:true});
 await alice.setViewportSize({width:390,height:844});assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);await alice.screenshot({path:'work/browser/business-team-mobile.png',fullPage:true});
 for(const role of ['reviewer','analyst']){await alice.getByRole('button',{name:'Manage Sam Rivera',exact:true}).click();await alice.getByLabel('Role for Sam Rivera').selectOption(role);await alice.getByRole('button',{name:'Save role',exact:true}).click();await expect(alice.getByRole('region',{name:'People with access'}).getByText(role,{exact:true})).toBeVisible();}
 await bob.goto(base+`/b/${firstBusiness}/team`);await expect(bob.getByRole('heading',{name:'Team',exact:true})).toBeVisible();await expect(bob.getByRole('button',{name:'Send invitation'})).toHaveCount(0);
 await alice.getByRole('button',{name:'Manage Sam Rivera',exact:true}).click();await alice.getByLabel('Role for Sam Rivera').selectOption('admin');await alice.getByRole('button',{name:'Save role',exact:true}).click();
 await bob.reload();await expect(bob.getByRole('button',{name:'Send invitation',exact:true})).toBeVisible();
 await expect(bob.getByRole('link',{name:'account team settings',exact:true})).toHaveCount(0);await expect(bob.getByRole('group',{name:'Businesses they can access'}).getByRole('checkbox')).toHaveCount(1);
 await expect(bob.getByLabel('Business role',{exact:true}).locator('option[value="admin"]')).toHaveCount(0);
 await bob.getByLabel('Teammate’s email').fill('delegated-browser@example.test');await bob.getByLabel('Business role',{exact:true}).selectOption('reviewer');await bob.getByRole('button',{name:'Send invitation',exact:true}).click();
 await expect(bob.getByText('Invitation saved and email queued.',{exact:false})).toBeVisible();assert.ok(await emailLink('delegated-browser@example.test','Your Desvio client invitation'));
 await bob.getByRole('button',{name:'Revoke invitation to delegated-browser@example.test',exact:true}).click();await expect(bob.getByText('Invitation revoked for every business included in that invitation.',{exact:true})).toBeVisible();
 assert.deepEqual((await new AxeBuilder({page:bob}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);await bob.screenshot({path:'work/browser/delegated-business-team.png',fullPage:true});
 await alice.getByRole('button',{name:'Manage Sam Rivera',exact:true}).click();await alice.getByRole('button',{name:'Remove access',exact:true}).click();await alice.getByRole('button',{name:'Confirm removal',exact:true}).click();await expect(alice.getByText('Access to this business removed.',{exact:false})).toBeVisible();
 await bob.reload();await expect(bob.getByRole('heading',{name:'Business unavailable'})).toBeVisible();await bob.goto(base+'/brands');await expect(bob.locator('.v5-business-card')).toHaveCount(1);await expect(bob.locator('.v5-business-card')).toContainText('Juniper Goods');await alice.setViewportSize({width:1440,height:1100});
});

test('Profile saves identity, revokes a separate session and changes the real password with other-session logout',async()=>{
 await admin.query('DELETE FROM auth."rateLimit"');
 const other=await browser.newContext();
 try{
  const login=()=>other.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password:password+'-new'}});
  assert.equal((await login()).status(),200);
  await alice.goto(base+'/profile');await expect(alice.getByRole('heading',{name:'Profile',exact:true})).toBeVisible();
  await alice.getByLabel('Your name',{exact:true}).fill('Sam Desvio');await alice.getByRole('button',{name:'Save name',exact:true}).click();await expect(alice.getByText('Your name is saved.',{exact:true})).toBeVisible();
  await alice.reload();await expect(alice.getByLabel('Your name',{exact:true})).toHaveValue('Sam Desvio');
  await expect(alice.getByRole('heading',{name:'Active sessions',exact:true})).toBeVisible();
  // Revoke all other authenticated browser sessions, preserving the current one.
  await alice.getByRole('button',{name:'Sign out all other sessions',exact:true}).click();await alice.getByRole('button',{name:'Confirm sign-out of other sessions',exact:true}).click();await expect(alice.getByText('Other sessions signed out.',{exact:true})).toBeVisible();
  assert.equal(await(await other.request.get(base+'/api/auth/get-session')).json(),null);
  assert.equal((await login()).status(),200);
  await alice.getByLabel('Current password',{exact:true}).fill(password+'-new');await alice.getByLabel('New password',{exact:true}).fill(password+'-profile');await alice.getByLabel('Confirm new password',{exact:true}).fill(password+'-profile');
  await alice.getByRole('button',{name:'Change password',exact:true}).click();await expect(alice.getByText('Password changed. Other sessions have been signed out.',{exact:true})).toBeVisible();
  assert.equal(await(await other.request.get(base+'/api/auth/get-session')).json(),null);await expect(alice.getByLabel('Current password',{exact:true})).toHaveValue('');
  assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);
  await alice.screenshot({path:'work/browser/profile-desktop.png',fullPage:true});await alice.setViewportSize({width:390,height:844});assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await alice.screenshot({path:'work/browser/profile-mobile.png',fullPage:true});
 }finally{await other.close();}
});

test('Profile authenticator setup → gated sign-in → recovery code → replacement and disable',async()=>{
 const {createOTP}=await import('@better-auth/utils/otp'),{base32}=await import('@better-auth/utils/base32');
 await alice.goto(base+'/profile');const panel=alice.getByRole('region',{name:'Two-factor authentication',exact:true});
 await panel.getByLabel('Password for security changes').fill(password+'-profile');await panel.getByRole('button',{name:'Set up authenticator app',exact:true}).click();
 const qr=panel.getByRole('img',{name:'Scan this QR code with your authenticator app'});await expect(qr).toBeVisible();assert.ok((await qr.getAttribute('src')).startsWith('data:image/png;base64,'));
 await panel.getByText('Enter a setup key manually',{exact:true}).click();const secret=await panel.getByLabel('Authenticator setup key').inputValue(),otp=createOTP(new TextDecoder().decode(base32.decode(secret))),codes=await panel.getByRole('list',{name:'Recovery codes',exact:true}).getByRole('listitem').allTextContents();assert.equal(codes.length,10);
 await expect(panel.getByRole('button',{name:'Enable two-factor authentication',exact:true})).toBeDisabled();
 assert.deepEqual((await new AxeBuilder({page:alice}).analyze()).violations,[]);assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await panel.screenshot({path:'work/browser/mfa-setup-mobile.png',mask:[qr,panel.getByLabel('Authenticator setup key'),panel.getByRole('list',{name:'Recovery codes',exact:true})]});
 await panel.getByRole('checkbox',{name:'I saved these recovery codes somewhere secure.'}).check();await panel.getByLabel('Confirm authenticator code').fill(await otp.totp());await panel.getByRole('button',{name:'Enable two-factor authentication',exact:true}).click();await expect(panel.getByText('Enabled · authenticator app',{exact:true})).toBeVisible();
 const context=await browser.newContext(),loginPage=await context.newPage();
 async function signIn(){await loginPage.goto(base+'/sign-in');await loginPage.getByLabel('Email address',{exact:true}).fill(email);await loginPage.getByLabel('Password',{exact:true}).fill(password+'-profile');await loginPage.getByRole('button',{name:'Sign in',exact:true}).click();await expect(loginPage.getByRole('heading',{name:'Verify it’s you.',exact:true})).toBeVisible();}
 try{
  await signIn();assert.equal(await(await loginPage.request.get(base+'/api/auth/get-session')).json(),null);assert.equal((await loginPage.request.get(base+'/api/v1/businesses')).status(),401);
  assert.deepEqual((await new AxeBuilder({page:loginPage}).analyze()).violations,[]);await loginPage.screenshot({path:'work/browser/mfa-sign-in.png',fullPage:true});
  await loginPage.getByLabel('Authenticator code',{exact:true}).fill(await otp.totp());await loginPage.getByRole('button',{name:'Verify and sign in',exact:true}).click();await expect(loginPage.getByRole('heading',{name:/^(Add your first business|Choose a business|Your content, at a glance\.)$/})).toBeVisible();
  await loginPage.request.post(base+'/api/auth/sign-out',{headers:{origin:base},data:{}});await admin.query('DELETE FROM auth."rateLimit"');await signIn();await loginPage.getByRole('button',{name:'Use a recovery code',exact:true}).click();await loginPage.getByLabel('Recovery code',{exact:true}).fill(codes[0]);await loginPage.getByRole('button',{name:'Verify and sign in',exact:true}).click();await expect(loginPage.getByRole('heading',{name:/^(Add your first business|Choose a business|Your content, at a glance\.)$/})).toBeVisible();
  await panel.getByLabel('Password for security changes').fill(password+'-profile');await panel.getByRole('checkbox',{name:/I understand replacing codes/}).check();await panel.getByRole('button',{name:'Replace recovery codes',exact:true}).click();await expect(panel.getByRole('heading',{name:'Recovery codes',exact:true})).toBeVisible();const replacements=await panel.getByRole('list',{name:'Recovery codes',exact:true}).getByRole('listitem').allTextContents();assert.equal(replacements.length,10);assert.ok(replacements.every(c=>!codes.includes(c)));await panel.getByRole('button',{name:'I saved my new recovery codes',exact:true}).click();
  await panel.getByLabel('Password for security changes').fill(password+'-profile');await panel.getByRole('checkbox',{name:/I understand replacing codes/}).check();await panel.getByRole('button',{name:'Disable two-factor authentication',exact:true}).click();await expect(panel.getByText('Not enabled',{exact:true})).toBeVisible();
  assert.deepEqual(await alice.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
 }finally{await context.close();}
});

test('Studio overview keeps real counts, working routes, narrow layouts and reduced-motion support',async()=>{
 const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const planResponse=await alice.request.post(`${base}/api/v1/businesses/${firstBusiness}/content-plans`,{headers:{origin:base,'idempotency-key':randomUUID()},data:{title:'TEST upcoming collection',objective:'Review a visual plan',starts_on:day,timezone:'UTC',slots:[{channel:'instagram',format:'static',planned_at:day+'T12:00:00Z',brief:'TEST upcoming botanical story'},{channel:'linkedin',format:'video',planned_at:day+'T14:00:00Z',brief:'TEST upcoming product video'}]}});
 assert.equal(planResponse.status(),201,await planResponse.text());
 await alice.setViewportSize({width:1440,height:1050});
 await alice.goto(base+`/b/${firstBusiness}/overview`);
 const upcoming=alice.getByRole('region',{name:'Upcoming posts',exact:true});
 await expect(upcoming).toBeVisible();
 await expect(upcoming.getByRole('link',{name:'View calendar',exact:true})).toHaveAttribute('href',`/b/${firstBusiness}/content-plan`);
 await expect(upcoming.getByRole('heading',{name:'TEST upcoming botanical story'})).toBeVisible();
 await expect(upcoming.locator('.upcoming-post')).toHaveCount(2);
 await expect(upcoming.getByText('Ready to create',{exact:true})).toHaveCount(2);
 const snapshot=await(await alice.request.get(base+`/api/v1/businesses/${firstBusiness}/overview`)).json();
 const campaignId=(await planResponse.json()).id;
 assert.equal(snapshot.campaigns.find(c=>c.id===campaignId).post_count,2);
 const campaigns=alice.getByRole('region',{name:'Your campaigns',exact:true});
 await expect(campaigns.getByRole('link',{name:'See all campaigns'})).toHaveAttribute('href',`/b/${firstBusiness}/campaigns`);
 await expect(campaigns.getByRole('link',{name:/TEST upcoming collection/})).toHaveAttribute('href',`/b/${firstBusiness}/campaign-review?plan=${campaignId}`);
 await expect(alice.locator('.overview-metric').filter({hasText:'Awaiting review'}).locator('strong')).toHaveText(String(snapshot.counts.awaiting_review));
 await expect(alice.getByRole('heading',{name:'Recent activity',exact:true})).toBeHidden();
 await alice.locator('.overview-details > summary').click();
 await expect(alice.getByRole('heading',{name:'Recent activity',exact:true})).toBeVisible();
 await alice.locator('.overview-details > summary').click();
 await alice.screenshot({path:'work/browser/studio-overview-desktop.png',fullPage:true,animations:'disabled'});
 for(const width of [1440,768,390,320]){
  await alice.setViewportSize({width,height:900});
  assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);
 }
 await alice.screenshot({path:'work/browser/studio-overview-mobile.png',fullPage:true});
 await alice.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await upcoming.locator('.upcoming-post').first().evaluate(e=>getComputedStyle(e).animationName),'none');
 await upcoming.getByRole('link',{name:'View calendar',exact:true}).focus();
 assert.equal(await alice.evaluate(()=>document.activeElement?.getAttribute('href')),`/b/${firstBusiness}/content-plan`);
 await alice.emulateMedia({reducedMotion:'no-preference'});
 await alice.setViewportSize({width:1440,height:1050});
 await upcoming.getByRole('link',{name:/TEST upcoming botanical story/}).click();
 await expect(alice.getByRole('region',{name:'Post details',exact:true})).toBeVisible();
 await expect(alice.getByLabel('Creative brief',{exact:true})).toHaveValue('TEST upcoming botanical story');
 await alice.goto(`${base}/b/${firstBusiness}/content-plan?start=${day}`);
 await expect(alice.getByLabel('Calendar view',{exact:true})).toHaveValue('week');
 await alice.getByText('Calendar options',{exact:true}).click();
 await alice.getByLabel('Calendar view',{exact:true}).selectOption('day');
 await alice.getByText('Calendar options',{exact:true}).click();
 const daily=alice.getByRole('region',{name:'Posts for selected day'});
 await expect(daily.getByRole('heading',{name:'TEST upcoming botanical story'})).toBeVisible();
 await daily.getByRole('button',{name:'Next post',exact:true}).click();
 await expect(daily.getByRole('heading',{name:'TEST upcoming product video'})).toBeVisible();
 await daily.getByRole('button',{name:'Previous post',exact:true}).click();
 await expect(daily.getByRole('heading',{name:'TEST upcoming botanical story'})).toBeVisible();
 await expect(alice.getByRole('button',{name:'Export CSV',exact:true})).toHaveCount(0);
 await expect(alice.getByRole('button',{name:'Export calendar',exact:true})).toHaveCount(0);
 for(const width of [1440,390,320]){await alice.setViewportSize({width,height:950});assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const violations=(await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations;assert.deepEqual(violations.map(v=>v.id),[],JSON.stringify(violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))));}
 await alice.setViewportSize({width:1440,height:1050});
 await alice.screenshot({path:'work/browser/daily-content-plan.png',fullPage:true});
 await alice.getByRole('button',{name:'Next day',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'Space for your next ideas'})).toBeVisible();
 await alice.getByText('Calendar options',{exact:true}).click();
 await alice.getByLabel('Calendar view',{exact:true}).selectOption('month');
 await alice.getByText('Calendar options',{exact:true}).click();
 await expect(alice.getByRole('list',{name:'Days in this view'})).toBeVisible();
 const otherPlan=await alice.request.post(`${base}/api/v1/businesses/${firstBusiness}/content-plans`,{headers:{origin:base,'idempotency-key':randomUUID()},data:{title:'TEST overlapping campaign',objective:'Check campaign filtering',starts_on:day,timezone:'UTC',slots:[{channel:'instagram',format:'static',planned_at:day+'T13:00:00Z',brief:'TEST separate campaign post'}]}});
 assert.equal(otherPlan.status(),201);
 await alice.goto(base+`/b/${firstBusiness}/overview`);
 await alice.getByRole('region',{name:'Your campaigns'}).getByRole('link',{name:'See all campaigns'}).click();
 await expect(alice.getByRole('heading',{name:'Campaigns',exact:true})).toBeVisible();
 await expect(alice.getByRole('heading',{name:'TEST overlapping campaign',exact:true})).toBeVisible();
 await alice.getByRole('link',{name:/TEST upcoming collection/}).click();
 await alice.getByRole('link',{name:'View calendar',exact:true}).click();
 await expect(alice.getByText('2 posts in this view',{exact:true})).toBeVisible();
 await alice.reload();
 await expect(alice.getByText('2 posts in this view',{exact:true})).toBeVisible();
 await alice.getByText('Calendar options',{exact:true}).click();
 await alice.getByRole('button',{name:'Show all campaigns',exact:true}).click();
 await expect(alice.getByText('3 posts in this view',{exact:true})).toBeVisible();
 assert.equal(new URL(alice.url()).searchParams.has('plan'),false);

});

test('module navigation preserves the workspace shell and does not repeat account initialization',async()=>{
 await alice.setViewportSize({width:1440,height:1000});await alice.goto(base+`/b/${firstBusiness}/overview`);
 await expect(alice.getByRole('navigation',{name:'Main navigation'})).toBeVisible();
 await expect(alice.getByRole('region',{name:'Upcoming posts',exact:true})).toBeVisible();
 let initializes=0;const observe=request=>{if(request.url().endsWith('/api/v1/accounts/current/initialize'))initializes++;};alice.on('request',observe);
 await alice.evaluate(()=>{window.__workspaceNavigationProbe='retained';document.querySelector('.v5-sidebar').dataset.probe='retained';});
 await alice.route('**/api/auth/get-session',async route=>{await setTimeout(800);await route.continue();});
 try{
  await alice.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Campaigns',exact:true}).click();
  await expect(alice).toHaveURL(new RegExp(`/b/${firstBusiness}/campaigns$`));
  await expect(alice.locator('.v5-sidebar[data-probe="retained"]')).toBeVisible();
  assert.equal(await alice.evaluate(()=>window.__workspaceNavigationProbe),'retained');
  await expect(alice.locator('.workspace-opening')).toHaveCount(0);
  await alice.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Home',exact:true}).click();
  await expect(alice.getByRole('region',{name:'Upcoming posts',exact:true})).toBeVisible();
  await alice.goBack();await expect(alice).toHaveURL(new RegExp(`/b/${firstBusiness}/campaigns$`));
  await expect(alice.locator('.v5-sidebar[data-probe="retained"]')).toBeVisible();assert.equal(initializes,0);
 }finally{alice.off('request',observe);await alice.unroute('**/api/auth/get-session');}
});

test('Back and Forward keep unsaved edits on cancel and navigate only after confirmation',async()=>{
 await alice.goto(base+'/overview');
 await alice.getByRole('link',{name:'Your account',exact:true}).click();
 const input=alice.getByLabel('Your name',{exact:true});await expect(input).toBeVisible();
 const original=await input.inputValue(),draft=original+' unsaved';await input.fill(draft);
 await alice.evaluate(()=>{window.__historyGuardProbe='retained';});
 let confirms=0;const stay=async dialog=>{assert.equal(dialog.type(),'confirm');confirms++;await dialog.dismiss();};
 alice.on('dialog',stay);
 try{
  await alice.goBack();await expect(alice).toHaveURL(base+'/profile');await expect(input).toHaveValue(draft);
  assert.equal(confirms,1);assert.equal(await alice.evaluate(()=>window.__historyGuardProbe),'retained');
  // Repeating cancellation must not create phantom history entries.
  await alice.goBack();await expect(alice).toHaveURL(base+'/profile');await expect(input).toHaveValue(draft);assert.equal(confirms,2);
 }finally{alice.off('dialog',stay);}
 alice.once('dialog',dialog=>dialog.accept());await alice.goBack();await expect(alice).toHaveURL(base+'/overview');
 await alice.goForward();await expect(alice).toHaveURL(base+'/profile');await expect(input).toHaveValue(original);
 // Build a genuine forward entry, return, then modify the retained form.
 await alice.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Home',exact:true}).click();
 await expect(alice).toHaveURL(base+'/overview');
 await alice.goBack();await expect(alice).toHaveURL(base+'/profile');await expect(input).toHaveValue(original);await input.fill(draft);
 alice.once('dialog',dialog=>dialog.dismiss());await alice.goForward();await expect(alice).toHaveURL(base+'/profile');await expect(input).toHaveValue(draft);
 alice.once('dialog',dialog=>dialog.accept());await alice.goForward();await expect(alice).toHaveURL(base+'/overview');
 assert.equal(await alice.evaluate(()=>window.__historyGuardProbe),'retained');
});

test('unknown website capture offers an explicit read-only recovery action',async()=>{
 const businessId=brandUrl.match(/\/b\/([^/]+)/)[1];
 const target=(await admin.query('SELECT id,organization_id FROM app.brands WHERE id=$1',[businessId])).rows[0];
 const actor=(await admin.query('SELECT user_id FROM app.memberships WHERE organization_id=$1 AND role=\'owner\' LIMIT 1',[target.organization_id])).rows[0].user_id;
 const job=randomUUID();
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,requested_by,kind,status,error_code) VALUES($1,$2,$3,$4,'website.extract','unknown','MAXUN_SUBMISSION_UNKNOWN')",[job,target.organization_id,target.id,actor]);
 await admin.query("INSERT INTO app.intake_requests(job_id,organization_id,brand_id,request_key,request_hash,website_url) VALUES($1,$2,$3,$4,'BROWSER FIXTURE','https://example.org/')",[job,target.organization_id,target.id,randomUUID()]);
 await admin.query("INSERT INTO app.website_capture_calls(job_id,organization_id,brand_id,checkpoint) VALUES($1,$2,$3,$4)",[job,target.organization_id,target.id,JSON.stringify({phase:'polling',robotId:randomUUID(),runId:randomUUID()})]);
 let posted;
 const route=async r=>{if(r.request().method()==='POST'){posted=r.request().postDataJSON();return r.abort();}return r.continue();};
 await alice.route('**/api/v1/businesses/*/intake',route);
 try{
  await alice.goto(brandUrl);
  const back=alice.getByRole('button',{name:'Back to brand review',exact:true});
  await expect(back).toBeVisible();await back.click();
  await alice.getByText('Sources & advanced options',{exact:true}).click();
  const action=alice.getByRole('button',{name:'Check existing capture',exact:true});await expect(action).toBeVisible();
  await expect(alice.getByText('Check the existing capture without starting another paid crawl.',{exact:false})).toBeVisible();
  await action.click();await expect.poll(()=>posted?.recoverJobId).toBe(job);
  assert.equal(posted.kind,'website.extract');assert.equal(posted.autoAnalyze,undefined);
 }finally{await alice.unroute('**/api/v1/businesses/*/intake',route);await admin.query("UPDATE app.jobs SET status='canceled' WHERE id=$1",[job]);}
});

test('Manage brand contains confirmed owner deletion and updates the business list',async()=>{
 const id=brandUrl.match(/\/b\/([^/]+)/)[1],org=(await admin.query('SELECT organization_id FROM app.brands WHERE id=$1',[id])).rows[0].organization_id;
 await admin.query('UPDATE app.account_entitlements SET max_active_businesses=100 WHERE organization_id=$1',[org]);
 const name='Delete browser brand';
 const created=await alice.request.post(base+'/api/v1/businesses',{headers:{origin:base,'idempotency-key':randomUUID()},data:{name}});assert.equal(created.status(),201);const business=await created.json();
 await alice.goto(base+'/brands');
 const card=alice.locator('article').filter({has:alice.getByRole('heading',{name,exact:true})});
 await expect(card.getByRole('button',{name:'Delete brand',exact:true})).not.toBeVisible();
 await card.getByRole('link',{name:'Manage brand'}).click();
 await expect(alice.getByRole('heading',{name:'Manage brand',exact:true})).toBeVisible();
 await expect(alice.getByRole('button',{name:'Delete brand',exact:true})).not.toBeVisible();
 await alice.locator('summary').filter({hasText:'Delete brand'}).click();
 const management=alice.locator('main');
 const remove=management.getByRole('button',{name:'Delete brand',exact:true});await expect(remove).toBeEnabled();
 await remove.click();await expect(management.getByRole('alert')).toContainText('Enter “'+name+'”');
 await expect(management.getByLabel('Type '+name+' to confirm',{exact:true})).toBeFocused();
 assert.equal((await alice.request.get(base+'/api/v1/businesses/'+business.id)).status(),200);
 await management.getByLabel('Type '+name+' to confirm',{exact:true}).fill(name);
 assert.deepEqual((await new AxeBuilder({page:alice}).analyze()).violations,[]);
 await remove.click();await expect(alice).toHaveURL(base+'/brands');await expect(card).toHaveCount(0);
 assert.equal((await alice.request.get(base+'/api/v1/businesses/'+business.id)).status(),404);
 await alice.reload();await expect(alice.getByRole('heading',{name,exact:true})).toHaveCount(0);
});

test('onboarding holds brand review until analysis finishes and hides capture controls',async()=>{
 const created=await alice.request.post(base+'/api/v1/businesses',{headers:{origin:base,'idempotency-key':randomUUID()},data:{name:'Onboarding progress fixture',website:'https://example.org/'}});assert.equal(created.status(),201);const b=await created.json();
 for(const [field,value] of [['brand_name','Onboarding progress fixture'],['offering','Appointment scheduling']]){const r=await alice.request.post(`${base}/api/v1/workspaces/${b.organization_id}/brands/${b.id}/brain/findings`,{headers:{origin:base,'idempotency-key':randomUUID()},data:{field,value}});assert.equal(r.status(),201);}
 let complete=false,submissions=0;
 const route=async r=>{if(r.request().method()!=='GET'){submissions++;return r.abort();}return r.fulfill({json:{jobs:[{id:'browser-fixture-analysis',kind:'brand.analyze',status:complete?'succeeded':'running',created_at:new Date().toISOString()},{id:'browser-fixture-capture',kind:'website.extract',status:'succeeded',result:{provider:'openai',method:'web_research',pages:['https://example.org/','https://example.org/about']},auto_analysis_job_id:'browser-fixture-analysis',created_at:'2026-01-01T00:00:00Z'}],visuals:[]}});};
 await alice.route(`**/api/v1/businesses/${b.id}/intake`,route);
 try{
 await alice.goto(`${base}/b/${b.id}/onboarding`);
 await expect(alice.getByRole('heading',{name:'Getting to know your business'})).toBeVisible();
 await alice.emulateMedia({reducedMotion:'no-preference'});
 const orbit=alice.locator('.brand-orbit-satellite');
 await expect(orbit).toHaveCSS('animation-name','brand-orbit');
 const startTransform=await orbit.evaluate(el=>getComputedStyle(el).transform);
 await expect.poll(()=>orbit.evaluate(el=>getComputedStyle(el).transform)).not.toBe(startTransform);
 await alice.screenshot({path:'work/browser/animated-research-loader.png',fullPage:true});
 await alice.emulateMedia({reducedMotion:'reduce'});
 await expect(orbit).toHaveCSS('animation-name','none');
 await alice.emulateMedia({reducedMotion:'no-preference'});

 await expect(alice.getByRole('heading',{name:'Your brand profile'})).toHaveCount(0);
 await expect(alice.getByRole('list',{name:'What we’ve found'})).toContainText('2 cited pages');
 await expect(alice.getByRole('list',{name:'What we’ve found'})).toContainText('Understanding your business');
 await expect(alice.getByRole('button',{name:'Read website again'})).toHaveCount(0);
 complete=true;
 await expect(alice.getByRole('heading',{name:'Your brand profile'})).toBeVisible({timeout:10000});
 await expect(alice.getByLabel('Who are your customers?')).toBeVisible();
 await expect(alice.getByRole('button',{name:'Read website again'})).not.toBeVisible();
 assert.equal(submissions,0);
 await alice.screenshot({path:'work/browser/onboarding-review-rework.png',fullPage:true});
 }finally{await alice.unroute(`**/api/v1/businesses/${b.id}/intake`,route);}
});

test('first-plan confirmation resumes its saved request then opens the campaign (MOCK planner)',async()=>{
 await alice.goto(base+'/brands/new');await expect(alice.getByRole('heading',{name:'Your content. Your brand.'})).toBeVisible();await alice.screenshot({path:'work/browser/onboarding-add-business.png',fullPage:true});
 const created=await alice.request.post(base+'/api/v1/businesses',{headers:{origin:base,'idempotency-key':randomUUID()},data:{name:'First plan fixture'}});assert.equal(created.status(),201);const b=await created.json(),root=`/api/v1/businesses/${b.id}`,brain=`/api/v1/workspaces/${b.organization_id}/brands/${b.id}/brain`;
 for(const [field,value] of [['brand_name','First plan fixture'],['offering','Appointment software'],['audience','Dental practices']]){
 const added=await alice.request.post(base+brain+'/findings',{headers:{origin:base,'idempotency-key':randomUUID()},data:{field,value}});assert.equal(added.status(),201);const f=await added.json();assert.equal((await alice.request.patch(`${base}${brain}/findings/${f.id}`,{headers:{origin:base},data:{revision:f.revision,decision:'correct'}})).status(),200);
 }
 const state=await(await alice.request.get(base+root+'/onboarding')).json();
 assert.equal((await alice.request.patch(base+root+'/onboarding',{headers:{origin:base},data:{revision:state.revision,step:3,goal:'leads',timezone:'Asia/Kuala_Lumpur',cadence:3,channels:['linkedin'],must_avoid:'',business_stage:'growing',growth_expectation:'',preferences_edited:true}})).status(),200);
 const job=randomUUID(),plan=randomUUID();let completed=false,submissions=[];
 const generate=async r=>{submissions.push({body:r.request().postDataJSON(),key:r.request().headers()['idempotency-key']});await r.fulfill({status:201,json:{id:job,status:'queued'}});};
 const jobs=async r=>r.fulfill({json:{jobs:[{id:job,status:completed?'succeeded':'queued',output_plan_id:completed?plan:null,preferences:{starts_on:'2026-11-01'},scheduled_at:new Date().toISOString()}]}});
 const detail=async r=>r.fulfill({json:{id:plan,starts_on:'2026-11-01',timezone:'Asia/Kuala_Lumpur',duration_days:7,title:'First saved plan'}});
 await alice.route('**'+root+'/content-plan/generate',generate);await alice.route('**'+root+'/content-plan/jobs',jobs);await alice.route('**'+root+'/content-plans/'+plan,detail);
 try{
 await alice.goto(`${base}/b/${b.id}/onboarding`);
 await alice.getByLabel('Plan duration',{exact:true}).selectOption('7');await alice.getByLabel('Video ideas',{exact:true}).fill('');await expect(alice.getByLabel('Video ideas',{exact:true})).toHaveValue('');await alice.getByLabel('Video ideas',{exact:true}).fill('1');
 await alice.getByRole('button',{name:'Confirm & create my calendar',exact:true}).click();
 await expect(alice).toHaveURL(`${base}/b/${b.id}/onboarding`);await expect(alice.getByRole('heading',{name:'Building your calendar',exact:true})).toBeVisible();
 await alice.reload();await expect(alice).toHaveURL(`${base}/b/${b.id}/onboarding`);await expect(alice.getByRole('heading',{name:'Building your calendar',exact:true})).toBeVisible();
 completed=true;await expect(alice).toHaveURL(`${base}/b/${b.id}/campaign-review?plan=${plan}`,{timeout:15000});await expect(alice.getByText('First saved plan',{exact:true})).toBeVisible();
 assert.equal(submissions.length,1);assert.equal(submissions[0].body.provider,'openai');assert.equal(submissions[0].body.duration_days,7);assert.equal(submissions[0].body.video_count,1);assert.ok(submissions[0].key);
 }finally{await alice.unroute('**'+root+'/content-plan/generate',generate);await alice.unroute('**'+root+'/content-plan/jobs',jobs);await alice.unroute('**'+root+'/content-plans/'+plan,detail);}
});

 test('Content Preferences saves defaults and preserves drafts on a stale save',async()=>{
 await alice.goto(base+`/b/${firstBusiness}/content-preferences`);
 await expect(alice.getByRole('heading',{name:'Content Preferences',exact:true})).toBeVisible();
 await alice.getByRole('checkbox',{name:'Instagram',exact:true}).check();
 await alice.getByLabel('Posts per week',{exact:true}).fill('7');
 await alice.getByLabel('Topics or claims to avoid',{exact:true}).fill('No exaggerated savings claims');
 await alice.getByRole('button',{name:'Save preferences',exact:true}).click();
 await expect(alice.getByRole('status').filter({hasText:'Preferences saved.'})).toBeVisible();
 await alice.reload();await expect(alice.getByLabel('Posts per week',{exact:true})).toHaveValue('7');
 await expect(alice.getByLabel('Topics or claims to avoid',{exact:true})).toHaveValue('No exaggerated savings claims');
 const path=base+`/api/v1/businesses/${firstBusiness}/onboarding`;
 const current=await(await alice.request.get(path)).json();
 const {revision,step,goal,timezone,cadence,channels,must_avoid,business_stage,growth_expectation}=current;
 assert.equal((await alice.request.patch(path,{headers:{origin:base},data:{revision,step,goal,timezone,cadence,channels,must_avoid,business_stage,growth_expectation,preferences_edited:true}})).status(),200);
 await alice.getByLabel('Posts per week',{exact:true}).fill('9');await alice.getByRole('button',{name:'Save preferences',exact:true}).click();
 await expect(alice.getByRole('alert').filter({hasText:/changed/})).toBeVisible();await expect(alice.getByLabel('Posts per week',{exact:true})).toHaveValue('9');
 alice.once('dialog',dialog=>dialog.accept());await alice.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(alice.getByLabel('Posts per week',{exact:true})).toHaveValue('7');
 await alice.setViewportSize({width:390,height:844});assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.screenshot({path:'work/browser/content-preferences-mobile.png',fullPage:true});
 await alice.goto(base+`/b/${firstBusiness}/memory`);
 await expect(alice.getByRole('heading',{name:'Learnings',exact:true})).toBeVisible();
 await expect(alice.getByText('Olive & Field',{exact:true}).last()).toBeVisible();
 await alice.getByRole('searchbox',{name:'Search brand knowledge'}).fill('no such saved fact');
 await expect(alice.getByText('No facts match “no such saved fact”.')).toBeVisible();
 await alice.getByRole('searchbox',{name:'Search brand knowledge'}).fill('');
 await alice.getByRole('button',{name:'Sources',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'Saved brand sources',exact:true})).toBeVisible();
 await alice.getByRole('button',{name:'What’s working',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'Performance lessons',exact:true})).toBeVisible();
 await alice.getByRole('button',{name:'Brand knowledge',exact:true}).click();
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await alice.screenshot({path:'work/browser/learnings-refined-mobile.png',fullPage:true});
 await alice.setViewportSize({width:1440,height:1000});
 await alice.screenshot({path:'work/browser/learnings-refined-desktop.png',fullPage:true});

 });

test('campaign builder reviews details and resumes the same uncertain request after reload (MOCK transport)',async()=>{
 const settingsPath=base+`/api/v1/businesses/${firstBusiness}/onboarding`;
 const current=await(await alice.request.get(settingsPath)).json();
 const {revision,goal,timezone,cadence,channels,must_avoid,business_stage,growth_expectation}=current;
 assert.equal((await alice.request.patch(settingsPath,{headers:{origin:base},data:{revision,step:3,goal,timezone,cadence,channels,must_avoid,business_stage,growth_expectation,preferences_edited:true}})).status(),200);
 await alice.goto(base+`/b/${firstBusiness}/campaigns`);await alice.getByRole('button',{name:'＋ Create new',exact:true}).click();await alice.getByRole('dialog').getByRole('link',{name:/Campaign A themed set/}).click();
 await expect(alice.getByRole('heading',{name:'What’s your campaign about?',exact:true})).toBeVisible();
 await alice.getByLabel('Campaign name',{exact:true}).fill('A fresh start');await alice.getByLabel('Theme',{exact:true}).fill('Introduce our refill range with practical everyday tips.');
 await alice.getByLabel('Call to action (optional)',{exact:true}).fill('Explore the range');await alice.getByLabel('Target link (optional)',{exact:true}).fill('www.example.com/refills');
 await alice.getByRole('button',{name:'Continue',exact:true}).click();await alice.getByRole('checkbox',{name:'Instagram',exact:true}).check();await alice.getByRole('checkbox',{name:'LinkedIn',exact:true}).uncheck();
 await alice.getByLabel('Image posts',{exact:true}).fill('1');await alice.getByLabel('Image posts shape',{exact:true}).selectOption('portrait');
 await alice.getByLabel('Carousels',{exact:true}).fill('1');await alice.getByLabel('Slides per carousel',{exact:true}).fill('4');
 await alice.getByLabel('Image stories',{exact:true}).fill('1');await alice.getByLabel('Reels',{exact:true}).fill('1');await alice.getByLabel('Video stories',{exact:true}).fill('1');await alice.getByLabel('Video posts',{exact:true}).fill('1');
 await alice.getByRole('checkbox',{name:'LinkedIn',exact:true}).check();await alice.getByRole('group',{name:'Choose a platform',exact:true}).getByRole('button',{name:'LinkedIn',exact:true}).click();await expect(alice.getByLabel('Reels',{exact:true})).toHaveCount(0);await expect(alice.getByLabel('Image stories',{exact:true})).toHaveCount(0);await expect(alice.getByLabel('Video stories',{exact:true})).toHaveCount(0);
 await alice.getByRole('checkbox',{name:'LinkedIn',exact:true}).uncheck();await expect(alice.getByLabel('Slides per carousel',{exact:true})).toHaveValue('4');
 await alice.setViewportSize({width:390,height:844});assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);await alice.screenshot({path:'work/browser/campaign-format-mix-mobile.png',fullPage:true});await alice.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'Find your visual style',exact:true})).toBeVisible();
 await alice.getByRole('radio',{name:/Editorial/}).check();await alice.getByRole('button',{name:'Continue',exact:true}).click();
 await alice.getByRole('radio',{name:/Classic/}).check();await alice.setViewportSize({width:390,height:844});
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.screenshot({path:'work/browser/campaign-font-picker.png',fullPage:true});
 await alice.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'How creative should we get?',exact:true})).toBeVisible();
 await alice.getByRole('radio',{name:'Super creative',exact:true}).check();
 await alice.getByRole('button',{name:'Back',exact:true}).click();await alice.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(alice.getByRole('radio',{name:'Super creative',exact:true})).toBeChecked();
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.screenshot({path:'work/browser/campaign-creativity.png',fullPage:true});
 await alice.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(alice.getByRole('heading',{name:'A fresh start',exact:true})).toBeVisible();
 await alice.setViewportSize({width:390,height:844});assert.ok(await alice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.getByText('Make it yours',{exact:false}).click();await alice.getByRole('button',{name:'Warm',exact:true}).click();await alice.getByLabel('Inspiration brands',{exact:true}).fill('Editorial magazines');await alice.getByLabel('Include',{exact:true}).fill('Approved refill details');await alice.getByLabel('Avoid',{exact:true}).fill('Discount claims');
 assert.deepEqual((await new AxeBuilder({page:alice}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await alice.screenshot({path:'work/browser/campaign-builder-review.png',fullPage:true});
 const campaignThread=randomUUID(),submitted=[],route='**/api/v1/businesses/'+firstBusiness+'/content-plan/generate';
 const transport=async r=>{submitted.push({key:r.request().headers()['idempotency-key'],body:r.request().postDataJSON()});if(submitted.length===1)await r.abort();else await r.fulfill({status:201,json:{id:randomUUID(),thread_id:campaignThread,status:'queued'}});};
 await alice.route(route,transport);
 try{await alice.getByRole('button',{name:'Create campaign plan',exact:true}).click();await expect(alice.getByRole('button',{name:'Check campaign request',exact:true})).toBeEnabled();await alice.reload();
 await expect(alice.getByRole('heading',{name:'A fresh start',exact:true})).toBeVisible();await alice.getByRole('button',{name:'Check campaign request',exact:true}).click();await expect(alice).toHaveURL(base+`/b/${firstBusiness}/campaign-review?created=1&thread=${campaignThread}`);
 assert.equal(submitted.length,2);assert.deepEqual(submitted[0],submitted[1]);assert.equal(submitted[0].body.campaign.target_url,'www.example.com/refills');assert.deepEqual(submitted[0].body.campaign.refinement,{tone:'Warm',references:'Editorial magazines',include:'Approved refill details',avoid:'Discount claims'});assert.deepEqual(submitted[0].body.campaign.design,{style:'editorial',font:'classic',creativity:'super_creative'});assert.equal(submitted[0].body.post_count,6);assert.equal(submitted[0].body.video_count,3);assert.deepEqual(submitted[0].body.content_mix.map(row=>[row.format,row.creative_spec.placement,row.creative_spec.aspect,row.creative_spec.slide_count,row.count]),[['static','feed','portrait',null,1],['carousel','feed','square',4,1],['static','story','vertical',null,1],['video','reel','vertical',null,1],['video','story','vertical',null,1],['video','feed','square',null,1]]);assert.deepEqual(submitted[0].body.campaign.channels,['instagram']);assert.equal(submitted[0].body.campaign.design.creativity,'super_creative');
 }finally{await alice.unroute(route,transport);}
});

test('onboarding renders website photos and incomplete capture metadata without crashing', async () => {
  const route = '**/api/v1/businesses/' + firstBusiness + '/intake';
  const transport = async r => {
    const response = await r.fetch();
    const data = await response.json();
    data.visuals = [
      {id:randomUUID(),viewport:'photo',width:640,height:480,website_url:'https://example.com',observations:{kind:'website_photo',label:'Website photo fixture',images:[]},coverage:{resourceFailures:[]}},
      {id:randomUUID(),viewport:'desktop',width:1440,height:900,website_url:'https://example.com',observations:{},coverage:{}},
      {id:randomUUID(),viewport:'mobile',width:390,height:844,website_url:'https://example.com',observations:null,coverage:null},
    ];
    await r.fulfill({response,json:data});
  };
  const failures=[];const onError=e=>failures.push(e.message);alice.on('pageerror',onError);
  await alice.route(route,transport);
  try {
    await alice.goto(base+`/b/${firstBusiness}/onboarding`);
    await expect(alice.getByRole('heading',{name:'Website photo · Website photo fixture',exact:true,includeHidden:true})).toHaveCount(1);
    await expect(alice.getByText('This page couldn’t load',{exact:true})).toHaveCount(0);
    assert.deepEqual(failures,[]);
  } finally {await alice.unrouteAll({behavior:'wait'});alice.off('pageerror',onError);}
});
