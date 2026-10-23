import {readZip} from '../fixtures/read-zip.mjs';
import {CarouselJobs} from '../../dist/carousel-jobs.js';
import {carouselPlan} from '../fixtures/carousel-planning.mjs';
import {MalwareScanner} from '../../dist/file-validation.js';
import {GoogleGenAI} from '@google/genai';
import {GeminiPlanner} from '../../dist/gemini-planner.js';
import {ContentPlan} from '../../dist/content-plan.js';
import {VideoJobs} from '../../dist/video-jobs.js';
import {VideoReferences} from '../../dist/video-references.js';
import {VideoProviderJobs} from '../../dist/video-provider-jobs.js';
import {VideoRenderer} from '../../dist/video-renderer.js';
import {VideoDownload} from '../../dist/video-download.js';
import {canonicalJSON,hash} from '../../dist/brand-brain.js';
import {prepareVideoImage} from '../../scripts/video-runtime-image.mjs';
import {execFileSync} from 'node:child_process';
let videoSubmits=0;
import {PlanningJobs} from '../../dist/planning-jobs.js';
import {ExportJobs} from '../../dist/export-jobs.js';
import {StaticRenderer} from '../../dist/static-renderer.js';
import {Businesses} from '../../dist/businesses.js';
import {Workspaces} from '../../dist/workspaces.js';
import {generatedPlan,modelResponse} from '../fixtures/planning.mjs';
// Browser integration proof uses real auth, RLS, Temporal, S3, Fabric and isolated
// owner skills. Only the paid OpenAI transport is MOCK; no provider request leaves this test.
import { test, before, after, afterEach } from "node:test";
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
import { ObjectStore, digest } from "../../dist/object-store.js";
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
  failImages = false,referenceBytes,referenceUploads=0;
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
  config.smtp.port = smtp.port;config.videoEnabled=true;
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
  const jobs = new AssetJobs(workerPool, store, new MalwareScanner(config.scanner));
  const provider = new CreativeProvider(
    undefined,
    new OpenAI({
      apiKey: "fixture-only",
      maxRetries: 0,
      fetch: async (url, init) => {
        if (String(url).startsWith("data:")) return fetch(url, init);
        if (new URL(url).pathname === "/v1/responses") {

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
          if(input.task==='video')return modelResponse({title:'TEST video',caption:'TEST video caption',video_prompt:'TEST subtle camera motion',fact_ids:[input.brand.facts[0].id],warnings:[],beats:[{start_ms:0,end_ms:input.duration_seconds*1000,action:'Show the approved image',camera:'Slow push'}],overlays:[{text:'Discover more',start_ms:0,end_ms:2000,position:'bottom',foreground:'#ffffff',background:'#111111'}]});
          if(input.task==='carousel'){const plan=carouselPlan(input.slide_count);for(const slide of plan.slides){slide.fact_ids=[input.brand.facts[0].id];slide.headline=`Story ${slide.position}`;slide.body='';slide.cta='';}return modelResponse(plan);}
          if(input.task==='content_plan')return modelResponse(generatedPlan(input));
          planned++;
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
        if (new URL(url).pathname === "/v1/images/edits") {
          const references=init.body.getAll('image[]');
          if(references.length){assert.equal(references.length,1);assert.deepEqual(await sharp(Buffer.from(await references[0].arrayBuffer())).raw().toBuffer(),await sharp(referenceBytes).raw().toBuffer());referenceUploads++;}
          else assert.equal(init.body.get("image").type, "image/png");
        }
        else assert.equal(new URL(url).pathname, "/v1/images/generations");
        return Response.json({
          created: 1,
          data: [{ b64_json: png.toString("base64") }],
        });
      },
    }),
  );
  const gemini=new GeminiPlanner(undefined,new GoogleGenAI({apiKey:'LOCAL GEMINI MOCK',httpOptions:{apiVersion:'v1beta',retryOptions:{attempts:1},fetch:async(url,init)=>{
   assert.equal(new URL(url).pathname,'/v1beta/models/gemini-fixture:generateContent');const wire=JSON.parse(init.body),raw=wire.contents.flatMap(m=>m.parts).find(p=>p.text?.startsWith('UNTRUSTED BUSINESS DATA AND REQUEST:\n')).text,input=JSON.parse(raw.slice(raw.indexOf('\n')+1));
   if(input.task==='video')return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify({title:'TEST video',caption:'TEST video caption',video_prompt:'TEST subtle camera motion',fact_ids:[input.brand.facts[0].id],warnings:[],beats:[{start_ms:0,end_ms:input.duration_seconds*1000,action:'Show the approved image',camera:'Slow push'}],overlays:[{text:'Discover more',start_ms:0,end_ms:2000,position:'bottom',foreground:'#ffffff',background:'#111111'}]})}]},finishReason:'STOP'}]});
   if(input.task!=='content_plan'){
    planned++;const brief={headline:planned===1?'TEST FIXTURE: A little everyday care':'TEST FIXTURE: Fresh perspective',body:'Refillable botanical soap',cta:'Explore the collection',caption:'TEST FIXTURE: Botanical soap, made for your everyday ritual.',image_prompt:'TEST FIXTURE: Still life with room for text',palette:['#e6d5bb','#201e1d'],fact_ids:[input.brand.facts.find(f=>f.field==='offering').id],warnings:['TEST FIXTURE — no live generation']};
    return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(brief)}]},finishReason:'STOP'}]});
   }
   const settings=input.planning_mode==='natural'?{duration_days:7,post_count:7,video_count:2}:null;
   return Response.json({candidates:[{content:{role:'model',parts:[{text:JSON.stringify(settings?{...generatedPlan({...input,...settings}),settings}:generatedPlan(input))}]},finishReason:'STOP'}]});
  }}}));
  const handler = new CreativeJobs(
    jobs,
    new SkillRuntime(process.env.SKILL_RUNTIME_IMAGE),
    provider,gemini,
  );
  const planner=new PlanningJobs(jobs,new SkillRuntime(process.env.SKILL_RUNTIME_IMAGE),provider,gemini);
  const exporter=new ExportJobs(jobs,new StaticRenderer(process.env.RENDER_RUNTIME_IMAGE));
  const carousel=new CarouselJobs(jobs,handler,exporter);
  const carouselBeat=fn=>async(...args)=>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await fn(...args);}finally{clearInterval(timer);}};
  const videoImage=prepareVideoImage(),videoKey='ab'.repeat(32);
  const clip=Buffer.from(execFileSync('docker',['run','--rm','--network','none','--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--entrypoint','python',videoImage,'-c',"import sys,base64; sys.path.insert(0,'/runtime'); import runtime as r; r.command('ffmpeg',['-v','error','-f','lavfi','-i','color=blue:size=320x180:duration=3:rate=24','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','/tmp/test.mp4']); print(base64.b64encode(open('/tmp/test.mp4','rb').read()).decode())"],{encoding:'utf8',timeout:30000}).trim(),'base64');
  const videoProvider={prepare:intent=>({model:intent.model,idempotencyKey:intent.idempotencyKey,sha256:hash(canonicalJSON(intent))}),submit:async intent=>{videoSubmits++;assert.ok(intent.prompt.startsWith('TEST user edited video prompt'));assert.ok(intent.prompt.includes('TEST revised storyline'));assert.equal((await fetch(intent.referenceURL)).status,200);return {requestId:randomUUID()};},status:async()=>({state:'completed',videoURL:'https://video.example.org/fixture.mp4',errorCode:null}),cancel:async()=>{}};
  const video=new VideoJobs(jobs,new VideoReferences(undefined,jobs,videoKey,process.env.RENDER_RUNTIME_IMAGE,'test'),handler,new VideoProviderJobs(jobs,videoProvider,videoKey),new VideoDownload(['https://video.example.org'],{fetch:async()=>({status:200,headers:{'content-type':'video/mp4'},bytes:clip})}),new VideoRenderer(videoImage));
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
      planCarousel:carouselBeat(s=>carousel.plan(s)),prepareCarouselExport:carouselBeat((s,p)=>carousel.prepareExport(s,p)),checkCarouselExport:carouselBeat((s,p)=>carousel.checkExport(s,p)),completeCarousel:carouselBeat(s=>carousel.complete(s)),failCarousel:carouselBeat(s=>carousel.fail(s)),
      validate:async scope=>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await jobs.validate(scope);}finally{clearInterval(timer);}},
      fail:scope=>jobs.fail(scope),
      stepVideo:async scope=>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await video.step(scope);}finally{clearInterval(timer);}},
      failVideo:scope=>video.exhausted(scope),
      exportCreative:async scope=>{const context=Context.current(),timer=setInterval(()=>context.heartbeat(),1000);try{return await exporter.run(scope);}finally{clearInterval(timer);}},
      failExport:scope=>exporter.fail(scope),
      generatePlan:scope=>planner.run(scope),
      failPlan:scope=>planner.fail(scope),
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
afterEach(async()=>{if(errors.length)console.error('BROWSER ERRORS',JSON.stringify(errors));});

test("Canvas browser creates a real queued job, renders a private creative and saves editable Fabric layers (MOCK OpenAI)", async () => {
  await admin.query("INSERT INTO app.gemini_creative_grants(organization_id,brand_id,enabled,text_model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'gemini-fixture',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL BROWSER MOCK')",[org,brand]);
  const photoBytes=await sharp({create:{width:1440,height:900,channels:3,background:'#c4bca0'}}).jpeg().toBuffer();
  await page.goto(`${base}/b/${brand}/canvas`);
  await page.getByLabel('Creative planning model',{exact:true}).selectOption('gemini');
  await page.getByText('Brand image references',{exact:true}).click();
  await page.getByText('Add product photos',{exact:true}).click();
  await page.getByLabel('Choose a product photo',{exact:true}).setInputFiles({name:'canvas-product.jpg',mimeType:'image/jpeg',buffer:photoBytes});
  await page.getByRole('button',{name:'Upload file',exact:true}).click();
  const approval=page.getByRole('region',{name:'Approve reference: Uploaded product photo',exact:true});
  await expect(approval.getByLabel('Reference name',{exact:true})).toBeVisible({timeout:60000});
  await approval.getByLabel('Use part of this image',{exact:true}).check();await approval.getByRole('combobox',{name:/^Crop shape/}).selectOption('square');
  await approval.getByRole('button',{name:'Preview selected crop',exact:true}).click();await expect(approval.getByRole('img',{name:'Selected reference crop',exact:true})).toBeVisible();
  await approval.getByLabel('Reference name',{exact:true}).fill('Botanical brand reference');
  await approval.getByLabel('I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.',{exact:true}).check();
  await approval.getByRole('button',{name:'Approve image reference',exact:true}).click();
  const normalized=(await admin.query("SELECT v.object_key FROM app.uploaded_visuals v JOIN app.assets a ON a.id=v.asset_id WHERE a.brand_id=$1 AND a.filename='canvas-product.jpg'",[brand])).rows[0];
  referenceBytes=await sharp(await store.read(normalized.object_key)).extract({left:270,top:0,width:900,height:900}).png().toBuffer();
  await page.getByRole('checkbox',{name:'Botanical brand reference',exact:true}).check();
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
  assert.equal(referenceUploads,1);
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
  await page.getByRole('button',{name:'Prepare final image',exact:true}).click();
  await expect(page.getByRole('img',{name:'Saved final image for approval'})).toBeVisible({timeout:30000});
  const confirm=page.getByLabel('I reviewed this saved image and its text.');
  await expect(confirm).toBeEnabled();
  await expect(page.getByRole('button',{name:'Approve final image',exact:true})).toBeDisabled();
  await confirm.check();
  await page.getByRole('button',{name:'Approve final image',exact:true}).click();
  await expect(page.getByText('Final image approved for this creative version.',{exact:true})).toBeVisible();
  const exportApproval=(await admin.query("SELECT a.*,e.sha256 FROM app.creative_export_approvals a JOIN app.creative_exports e ON e.id=a.export_id WHERE a.brand_id=$1",[brand])).rows;
  assert.equal(exportApproval.length,1);assert.equal(exportApproval[0].context_type,'canvas');
  const finalDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download final image',exact:true}).click();
  const finalBytes=await readFile(await(await finalDownload).path());
  assert.equal((await import('node:crypto')).createHash('sha256').update(finalBytes).digest('hex'),exportApproval[0].sha256);
  await page.screenshot({path:'work/browser/canvas-final-image.png',fullPage:true});
  await admin.query("INSERT INTO app.video_grants(organization_id,brand_id,models,expires_at,budget_micros,max_create_micros,max_edit_micros,operator_reference,enabled) VALUES($1,$2,ARRAY['kling-video/v3.0/std/image-to-video'],now()+interval '1 hour',10000000,100000,100000,'LOCAL BROWSER TEST ONLY',true)",[org,brand]);
  const videoPlans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
  const linkedPlan=await videoPlans.create(actor,brand,{title:'Browser video plan',objective:'Create a planned video',starts_on:'2027-01-01',timezone:'Asia/Kuala_Lumpur',slots:[{channel:'instagram',format:'video',brief:'TEST planned browser video',planned_at:'2027-01-06T04:00:00Z'}]},randomUUID());
  let videoSlot=(await videoPlans.list(actor,brand,{start:'2027-01-01T00:00:00Z',end:'2027-02-01T00:00:00Z',plan_id:linkedPlan.id})).slots[0];
  videoSlot=await videoPlans.edit(actor,brand,videoSlot.id,{revision:videoSlot.revision,video_draft:{storyline:'TEST planned storyline',script:'TEST planned script',prompt:'TEST planned prompt',duration_seconds:3}});
  await page.goto(`${base}/b/${brand}/canvas?slot=${videoSlot.id}`);
  await expect(page.getByRole('region',{name:'Video calendar context'})).toBeVisible();
  await page.getByText('Make a video from this approved image',{exact:true}).click();
  await expect(page.getByLabel('Video idea',{exact:true})).toHaveValue(/TEST planned script/);
  await page.getByLabel('Video idea',{exact:true}).fill('TEST animate this brand image');
  await page.getByLabel('Video length (seconds)',{exact:true}).fill('3');
  await page.getByLabel('Video script model',{exact:true}).selectOption('gemini');
  await page.getByRole('button',{name:'Draft video script',exact:true}).click();
  await expect(page.getByLabel('Video prompt',{exact:true})).toBeVisible({timeout:60000});assert.equal(videoSubmits,0);
  await page.getByLabel('Video prompt',{exact:true}).fill('TEST user edited video prompt');
  await page.getByLabel('Scene 1 action',{exact:true}).fill('TEST revised storyline');
  await page.getByRole('button',{name:'Save video draft',exact:true}).click();
  await page.reload();await expect(page.getByLabel('Video prompt',{exact:true})).toHaveValue('TEST user edited video prompt');assert.equal(videoSubmits,0);
  await page.getByLabel('I approve this prompt and authorize video generation using the configured allowance.').check();
  await page.getByRole('button',{name:'Approve prompt and generate video',exact:true}).click();
  await expect(page.getByRole('link',{name:'Download video',exact:true})).toBeVisible({timeout:150000});assert.equal(videoSubmits,1);
  const player=page.getByLabel('Saved video preview',{exact:true});await player.evaluate(el=>el.play());await expect.poll(()=>player.evaluate(el=>el.currentTime)).toBeGreaterThan(0.25);await player.evaluate(el=>el.pause());
  await page.getByRole('button',{name:'Send video for review',exact:true}).click();
  await page.getByLabel('I reviewed this saved video and caption.').check();
  await page.getByRole('button',{name:'Approve final video',exact:true}).click();
  await expect(page.getByRole('region',{name:'Video review'}).getByRole('status')).toHaveText('approved');
  const savedVideo=(await admin.query('SELECT status,manifest FROM app.video_versions WHERE brand_id=$1',[brand])).rows[0];assert.equal(savedVideo.status,'approved');assert.equal(savedVideo.manifest.plan.brief.video_prompt,'TEST user edited video prompt');
  await page.screenshot({path:'work/browser/canvas-video-approved.png',fullPage:true});
  const canvasURL=page.url();
  await page.getByRole('link',{name:'Open linked video post in calendar',exact:true}).click();
  await expect(page.getByLabel('Saved video preview',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Send for review',exact:true}).click();
  await page.getByRole('button',{name:'Approve post',exact:true}).click();
  await expect(page.getByText('Approved this saved version. It has not been published.',{exact:true})).toBeVisible();
  const calendarVideo=(await admin.query("SELECT state,video_version_id,creative_version_id FROM app.content_slots WHERE brand_id=$1 AND format='video'",[brand])).rows[0];assert.equal(calendarVideo.state,'approved');assert.ok(calendarVideo.video_version_id);assert.equal(calendarVideo.creative_version_id,null);
  await page.screenshot({path:'work/browser/calendar-video-approved.png',fullPage:true});
  await page.goto(canvasURL.split('?')[0]);



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

test('calendar generates a saved 30-day plan and a linked creative through real jobs; channel inbox persists feedback and bulk approval (MOCK OpenAI)',async()=>{
 // Explicit test-operator resolution of the preceding simulated lost response.
 await admin.query("UPDATE app.jobs SET status='rejected' WHERE brand_id=$1 AND status='unknown'",[brand]);failImages=false;
 const businesses=new Businesses(runtime.database,new Workspaces(runtime.database));
 await businesses.onboarding(actor,brand,{revision:0,step:3,goal:'awareness',timezone:'Asia/Kuala_Lumpur',cadence:3,channels:['linkedin','instagram'],must_avoid:'No unsupported claims',preferences_edited:true});
 await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'MOCK-plan',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL BROWSER TEST ONLY')",[org,brand]);
 await page.goto(`${base}/b/${brand}/content-plan`);
 await page.getByRole('button',{name:'Create content plan',exact:true}).click();
 await page.getByLabel('Plan starts on').fill('2026-11-01');
 await page.getByLabel('Anything to focus on?').fill('TEST FIXTURE: explain refillable soap');
 await page.getByRole('button',{name:'Generate draft plan',exact:true}).click();
 await expect(page.getByText('30 posts in this view',{exact:true})).toBeVisible({timeout:30000});

 const calendarDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export calendar',exact:true}).click();
 const exportedCalendar=await calendarDownload;assert.equal(exportedCalendar.suggestedFilename(),'desvio-content-plan.ics');
 const calendarText=await readFile(await exportedCalendar.path(),'utf8');assert.equal(calendarText.split('BEGIN:VEVENT').length-1,30);assert.ok(calendarText.includes('STATUS:TENTATIVE'));
 await page.screenshot({path:'work/browser/content-plan-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'LinkedIn',exact:true}).click();
 await expect(page.getByText('15 posts in this view',{exact:true})).toBeVisible();
 const beforeMove=(await admin.query("SELECT id,planned_at FROM app.content_slots WHERE brand_id=$1 AND hook='TEST FIXTURE hook 1'",[brand])).rows[0];
 await page.getByRole('button',{name:'Open LinkedIn post: TEST FIXTURE hook 1',exact:true}).dragTo(page.locator('[data-calendar-day="2026-11-02"]'),{targetPosition:{x:20,y:15}});
 await expect(page.getByText('New date prepared. Review and save your changes to move this post. Social publishing is unchanged.',{exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT planned_at FROM app.content_slots WHERE id=$1',[beforeMove.id])).rows[0].planned_at.toISOString(),beforeMove.planned_at.toISOString(),'Drop must not persist before review/save');
 await expect(page.getByLabel('Planned date & time (Asia/Kuala_Lumpur)')).toHaveValue('2026-11-02T16:00');
 await page.getByRole('button',{name:'Save post changes',exact:true}).click();
 await expect(page.getByText('Post changes saved.',{exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT planned_at FROM app.content_slots WHERE id=$1',[beforeMove.id])).rows[0].planned_at.toISOString(),'2026-11-02T08:00:00.000Z');
 await page.getByRole('button',{name:'Create creative',exact:true}).click();
 await expect(page.getByRole('button',{name:'Send for review',exact:true})).toBeEnabled({timeout:30000});
 const postSlot=(await admin.query("SELECT s.* FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id WHERE s.brand_id=$1 AND s.hook='TEST FIXTURE hook 1'",[brand])).rows[0];
 assert.ok(postSlot.creative_version_id);assert.equal(postSlot.state,'draft_ready');
 await page.getByLabel('Creative brief').fill('TEST FIXTURE: owner revised brief');
 await page.getByLabel('Planned date & time (Asia/Kuala_Lumpur)').fill('2026-11-03T10:00');
 await page.route(`**/content-slots/${postSlot.id}`,route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.continue());
 await page.getByRole('button',{name:'Save post changes',exact:true}).click();await expect(page.locator('.slot-panel .notice.error')).toBeVisible();await expect(page.getByLabel('Creative brief')).toHaveValue('TEST FIXTURE: owner revised brief');
 await page.unroute(`**/content-slots/${postSlot.id}`);
 await page.getByRole('button',{name:'Save post changes',exact:true}).click();await expect(page.getByText('Post changes saved.',{exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT planned_at FROM app.content_slots WHERE id=$1',[postSlot.id])).rows[0].planned_at.toISOString(),'2026-11-03T02:00:00.000Z');
 await page.getByRole('button',{name:'Send for review',exact:true}).click();await expect(page.getByRole('button',{name:'Approve post',exact:true})).toBeVisible();
 await page.getByLabel('Feedback or creative direction').fill('TEST FIXTURE: calmer image');await page.getByRole('button',{name:'Request changes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Revise creative',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Revise creative',exact:true}).click();
 await expect(page.getByRole('button',{name:'Send for review',exact:true})).toBeEnabled({timeout:30000});
 await page.goto(`${base}/b/${brand}/content-plan?start=2026-11-01`);
 await page.getByRole('button',{name:'Select drafts for review',exact:true}).click();
 await page.getByLabel('Select LinkedIn post: TEST FIXTURE hook 1').check();
 await page.getByRole('button',{name:'Send selected drafts for review',exact:true}).click();
 await expect(page.getByText('1 post sent for review. Nothing has been scheduled or published.',{exact:true})).toBeVisible();
 await page.goto(`${base}/b/${brand}/review`);await page.getByLabel('Review from').fill('2026-11-01');
 await page.getByRole('button',{name:'Instagram',exact:true}).click();await expect(page.getByText('Nothing waiting here',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'LinkedIn',exact:true}).click();await page.getByLabel('Select LinkedIn post: TEST FIXTURE hook 1').check();
 await expect(page.getByRole('button',{name:'Confirm bulk approval',exact:true})).toBeDisabled();await page.getByLabel('I have reviewed these 1 posts and approve their saved versions.').check();
 await page.getByRole('button',{name:'Confirm bulk approval',exact:true}).click();await expect(page.getByText('1 post approved. Nothing has been scheduled or published.',{exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT state FROM app.content_slots WHERE id=$1',[postSlot.id])).rows[0].state,'approved');
 await page.getByRole('button').filter({hasText:'TEST FIXTURE hook 1'}).click();await expect(page.getByRole('button',{name:'Revise creative',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Reopen review',exact:true}).click();
 await expect(page.getByRole('button',{name:'Approve post',exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button').filter({hasText:'TEST FIXTURE hook 1'}).click();
 await expect(page.getByRole('button',{name:'Approve post',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Approve post',exact:true}).click();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.content_slot_events WHERE slot_id=$1 AND action='review_reopened'",[postSlot.id])).rows[0].n,1);
 await page.getByRole('button',{name:'Prepare final image',exact:true}).click();
 await expect(page.getByRole('img',{name:'Saved final image for approval'})).toBeVisible({timeout:30000});
 await expect(page.getByLabel('I reviewed this saved image and its text.')).toBeEnabled();await page.getByLabel('I reviewed this saved image and its text.').check();
 await page.getByRole('button',{name:'Approve final image',exact:true}).click();await expect(page.getByText('Final image approved for this post.',{exact:true})).toBeVisible();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.creative_export_approvals WHERE context_type='slot' AND context_id=$1",[postSlot.id])).rows[0].n,1);
 await page.screenshot({path:'work/browser/review-inbox-desktop.png',fullPage:true});
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[]);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'work/browser/review-inbox-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);
 await page.setViewportSize({width:1440,height:1000});assert.deepEqual(errors,[]);
});

test('Canvas manual edits require explicit approved-post reset; other businesses cannot see the saved plan or review',async()=>{
 const before=(await admin.query("SELECT * FROM app.content_slots WHERE brand_id=$1 AND hook='TEST FIXTURE hook 1'",[brand])).rows[0];
 await page.getByRole('link',{name:'Edit in Canvas',exact:true}).click();
 await page.getByLabel('Post caption').fill('TEST FIXTURE: Manual revision from review');
 await page.getByRole('button',{name:'Save new version',exact:true}).click();await expect(page.getByText('Saved as a new draft version.',{exact:true})).toBeVisible();
 await page.goto(`${base}/b/${brand}/review`);await page.getByLabel('Review from').fill('2026-11-01');await page.getByRole('button').filter({hasText:'TEST FIXTURE hook 1'}).click();
 await expect(page.getByRole('button',{name:'Attach latest Canvas version',exact:true})).toBeDisabled();
 await expect(page.locator('.slot-caption')).not.toContainText('Manual revision from review');
 await page.getByLabel('I understand that changing this post resets approval and requires a new review.').check();
 await page.getByRole('button',{name:'Attach latest Canvas version',exact:true}).click();await expect(page.getByText('Latest Canvas version attached as an unapproved draft.',{exact:true})).toBeVisible();
 await expect(page.locator('.slot-caption')).toHaveText('TEST FIXTURE: Manual revision from review');
 const after=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[before.id])).rows[0];assert.equal(after.state,'draft_ready');assert.equal(after.approved_by,null);assert.notEqual(after.creative_version_id,before.creative_version_id);
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.content_slot_events WHERE slot_id=$1 AND action='approved'",[before.id])).rows[0].n,2);
 const other=(await admin.query("SELECT id FROM app.brands WHERE organization_id=$1 AND name='OTHER BUSINESS'",[org])).rows[0].id;
 await page.goto(`${base}/b/${other}/content-plan`);await page.getByLabel('Calendar date').fill('2026-11-01');await expect(page.getByText('Space for your next ideas',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Post details',exact:true})).toHaveCount(0);
 const denied=await page.request.get(`${base}/api/v1/businesses/${other}/content-slots/${before.id}`);assert.equal(denied.status(),404);assert.deepEqual(errors,[]);
});

test('Canvas creates a custom four-day plan and opens its actual saved calendar post',async()=>{
 await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,provider,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,'gemini',true,'gemini-fixture',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL BROWSER TEST ONLY')",[org,brand]);
 await page.goto(`${base}/b/${brand}/canvas`);
 await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
 await page.getByText('Plan content in Canvas',{exact:true}).click();
 await page.getByLabel('Planning model',{exact:true}).selectOption('gemini');
 await page.getByLabel('What should we plan?',{exact:true}).fill('TEST four-day launch sequence');
 await expect(page.getByText('Plan content in Canvas',{exact:true})).toHaveCount(1);
 await page.getByLabel('Set days and post counts myself',{exact:true}).check();
 await page.getByLabel('Planning days',{exact:true}).fill('4');
 await page.getByLabel('Videos in this plan',{exact:true}).fill('2');
 await page.getByLabel('Canvas plan starts on',{exact:true}).fill('2026-12-01');
 await page.getByLabel('Repeat this plan',{exact:true}).selectOption('3');
 await page.getByLabel('Total loop planning budget (USD)',{exact:true}).fill('5');
 await page.getByLabel('Allow recurring AI planning charges', {exact:false}).check();
 await page.getByRole('button',{name:'Plan my content',exact:true}).click();
 const preview=page.getByRole('region',{name:'Planned posts',exact:true});
 await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(4,{timeout:60000});
 const saved=(await admin.query("SELECT id,duration_days FROM app.content_plans WHERE brand_id=$1 AND starts_on='2026-12-01'",[brand])).rows[0];assert.equal(saved.duration_days,4);assert.equal((await admin.query('SELECT provider FROM app.planning_requests WHERE output_plan_id=$1',[saved.id])).rows[0].provider,'gemini');
 await page.reload();await page.getByText('Plan content in Canvas',{exact:true}).click();await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(4);
 await expect(page.getByRole('list',{name:'Conversation messages'})).toContainText('TEST four-day launch sequence');
 await expect(page.getByRole('list',{name:'Conversation messages'})).toContainText('Prepared 4 draft posts');
 await expect(page.getByRole('region',{name:'Conversation plans'}).getByRole('link',{name:'Open calendar · 2026-12-01'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Planning loops'})).toContainText('1 of 3 plans prepared');
 await page.getByRole('button',{name:'Stop planning loop',exact:true}).click();
 await expect(page.getByRole('region',{name:'Planning loops'})).toContainText('Stopped');
 const loopRow=(await admin.query('SELECT l.* FROM app.planning_loops l JOIN app.planning_requests r ON r.loop_id=l.id WHERE r.output_plan_id=$1',[saved.id])).rows[0];assert.ok(loopRow.stopped_at);assert.equal(Number(loopRow.budget_micros),5000000);
 await page.screenshot({path:'work/browser/canvas-planning-loop.png',fullPage:true});
 await preview.getByRole('link',{name:'Edit or review this post',exact:true}).first().click();
 await expect(page.getByLabel('Calendar date',{exact:true})).toHaveValue('2026-12-01');
 await expect(page.getByRole('region',{name:'Post details',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Planned video script',exact:true})).toHaveValue('TEST script 1');
 await page.getByLabel('Planned video prompt',{exact:true}).fill('TEST edited calendar video prompt');
 await page.getByRole('button',{name:'Save post changes',exact:true}).click();
 await page.reload();await expect(page.getByLabel('Planned video prompt',{exact:true})).toHaveValue('TEST edited calendar video prompt');
 await page.screenshot({path:'work/browser/canvas-custom-plan.png',fullPage:true});assert.deepEqual(errors,[]);
});


test('Canvas natural follow-up uses the edited selected plan and opens a new weekly calendar',async()=>{
 const original=(await admin.query("SELECT id FROM app.content_plans WHERE brand_id=$1 AND starts_on='2026-12-01'",[brand])).rows[0];
 const before=(await admin.query('SELECT id,revision,video_draft FROM app.content_slots WHERE plan_id=$1 ORDER BY planned_at,id',[original.id])).rows;
 await page.goto(`${base}/b/${brand}/canvas`);await page.getByText('Plan content in Canvas',{exact:true}).click();
 await expect(page.getByLabel('Use selected saved plan as context',{exact:true})).toBeChecked();
 await expect(page.getByLabel('Set days and post counts myself',{exact:true})).not.toBeChecked();
 await expect(page.getByLabel('Planning days',{exact:true})).toHaveCount(0);
 await page.getByLabel('Planning model',{exact:true}).selectOption('gemini');
 await page.getByLabel('What should we plan?',{exact:true}).fill('TEST: Make this a weekly plan with two videos and keep my edited script direction');
 await page.getByLabel('Canvas plan starts on',{exact:true}).fill('2027-01-01');
 await page.getByRole('button',{name:'Plan my content',exact:true}).click();
 const preview=page.getByRole('region',{name:'Planned posts',exact:true});await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(7,{timeout:60000});await expect(preview).toContainText('7 days · 7 posts · 2 videos');
 const request=(await admin.query("SELECT input,output_plan_id FROM app.planning_requests WHERE brand_id=$1 AND input->>'planning_mode'='natural'",[brand])).rows[0];
 assert.equal(request.input.reference_plan.id,original.id);assert.ok(request.input.reference_plan.slots.some(s=>s.video_draft?.prompt==='TEST edited calendar video prompt'));assert.ok(request.output_plan_id);
 assert.deepEqual((await admin.query('SELECT id,revision,video_draft FROM app.content_slots WHERE plan_id=$1 ORDER BY planned_at,id',[original.id])).rows,before);
 // A slow initial conversation fetch must not replace an already-open planner.
 await page.route('**/canvas/threads',async route=>{await delay(600);await route.continue();});
 await page.reload();await page.getByText('Plan content in Canvas',{exact:true}).click();await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(7);
 await page.unroute('**/canvas/threads');
 await expect(page.getByRole('list',{name:'Conversation messages'})).toContainText('Make this a weekly plan');
 await page.screenshot({path:'work/browser/canvas-natural-followup.png',fullPage:true});assert.deepEqual(errors,[]);
});

test('Reviewer can give calendar feedback without editing or generation; Analyst sees read-only controls',async()=>{
 const plans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
 const v=(await admin.query('SELECT v.* FROM app.creative_versions v JOIN app.creative_projects p ON p.latest_version_id=v.id WHERE v.brand_id=$1 ORDER BY v.created_at DESC LIMIT 1',[brand])).rows[0];
 const p=await plans.create(actor,brand,{title:'TEST reviewer access',objective:'Review boundaries',starts_on:'2027-03-01',timezone:'UTC',slots:[{channel:'linkedin',format:'static',planned_at:'2027-03-01T10:00:00Z',brief:'Reviewer approval fixture',creative_version_id:v.id}]},crypto.randomUUID());
 let s=(await plans.list(actor,brand,{start:'2027-03-01T00:00:00Z',end:'2027-04-01T00:00:00Z',plan_id:p.id})).slots[0];
 s=await plans.review(actor,brand,s.id,{revision:s.revision,creative_version_id:v.id,creative_sha256:v.sha256,decision:'pending_review'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),reviewPage=await context.newPage(),email='reviewer-'+randomUUID()+'@example.test';
 const signup=await context.request.post(base+'/api/auth/sign-up/email',{headers:{origin:base},data:{name:'Review teammate',email,password:'reviewer-browser-password'}});assert.equal(signup.status(),200);const reviewerId=(await signup.json()).user.id;
 await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[reviewerId]);
 assert.equal((await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password:'reviewer-browser-password'}})).status(),200);
 await admin.query("INSERT INTO app.memberships(organization_id,user_id,role,business_scope) VALUES($1,$2,'editor','selected')",[org,reviewerId]);
 await admin.query("INSERT INTO app.business_memberships(organization_id,brand_id,user_id,role) VALUES($1,$2,$3,'reviewer')",[org,brand,reviewerId]);
 try{
  await reviewPage.goto(`${base}/b/${brand}/content-plan?start=2027-03-01&slot=${s.id}`);
  await expect(reviewPage.getByLabel('Creative brief',{exact:true})).toBeDisabled();
  await expect(reviewPage.getByRole('button',{name:'Revise creative',exact:true})).toHaveCount(0);
  await expect(reviewPage.getByLabel('Feedback or creative direction')).toBeEnabled();
  await reviewPage.getByLabel('Feedback or creative direction').fill('Reviewer: simplify the message.');
  await reviewPage.getByRole('button',{name:'Request changes',exact:true}).click();
  await expect(reviewPage.getByLabel('Feedback or creative direction')).toHaveValue('');
  assert.equal((await admin.query('SELECT state FROM app.content_slots WHERE id=$1',[s.id])).rows[0].state,'changes_requested');
  await admin.query("UPDATE app.business_memberships SET role='analyst' WHERE organization_id=$1 AND brand_id=$2 AND user_id=$3",[org,brand,reviewerId]);
  await reviewPage.reload();await expect(reviewPage.getByLabel('Feedback or creative direction')).toBeDisabled();await expect(reviewPage.getByRole('button',{name:'Approve post',exact:true})).toHaveCount(0);
  await reviewPage.goto(`${base}/b/${brand}/canvas`);await expect(reviewPage.getByRole('button',{name:'+ New conversation',exact:true})).toBeDisabled();
  assert.deepEqual((await new AxeBuilder({page:reviewPage}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);
 }finally{await context.close();}
});

test('Canvas composes generated slides as one carousel, reviews exact pixels, reorders into a new draft and survives reload',async()=>{
 await page.goto(`${base}/b/${brand}/canvas`);const root=`/api/v1/businesses/${brand}`;const slides=[];
 for(let i=0;i<2;i++){
  const t=await post(root+'/canvas/threads',{title:`TEST carousel slide ${i+1}`},randomUUID());assert.equal(t.status,201);
  const j=await post(root+`/canvas/threads/${t.body.id}/messages`,{prompt:`TEST carousel slide ${i+1}: botanical soap story`,format:'static',channel:'linkedin',size:'1024x1024',parent_version_id:null},randomUUID());assert.equal(j.status,201);
  await waitFor(async()=> (await admin.query('SELECT status FROM app.jobs WHERE id=$1',[j.body.id])).rows[0].status==='succeeded');
  const v=(await admin.query('SELECT v.id,v.sha256 FROM app.creative_requests r JOIN app.creative_versions v ON v.id=r.output_version_id WHERE r.job_id=$1',[j.body.id])).rows[0];
  const e=await post(root+`/creative-versions/${v.id}/exports`,{source_sha256:v.sha256},randomUUID());assert.equal(e.status,201);
  await waitFor(async()=> (await admin.query('SELECT count(*)::int AS n FROM app.creative_exports WHERE version_id=$1',[v.id])).rows[0].n===1);
  slides.push((await admin.query('SELECT id FROM app.creative_exports WHERE version_id=$1',[v.id])).rows[0].id);
 }
 await page.reload();const panel=page.getByRole('region',{name:'Carousels',exact:true});await panel.getByText('Carousels · compose and review slides',{exact:true}).click();
 await panel.getByLabel('Carousel title',{exact:true}).fill('TEST botanical story');await panel.getByLabel('Shared carousel caption',{exact:true}).fill('A single story across two slides.');
 for(let i=0;i<2;i++){await panel.getByRole('button',{name:'Add slide',exact:true}).click();await panel.getByLabel(`Saved image for slide ${i+1}`,{exact:true}).selectOption(slides[i]);await panel.getByLabel(`Alt text for slide ${i+1}`,{exact:true}).fill(`Botanical slide ${i+1}`);}
 const corruptPreview='**/creative-exports/'+slides[0]+'/download';await page.route(corruptPreview,async route=>{const response=await route.fetch(),grant=await response.json();await route.fulfill({response,json:{...grant,sha256:'0'.repeat(64)}});});
 await panel.getByRole('button',{name:'Save carousel',exact:true}).click();await expect(panel.getByText('Carousel saved as a draft. Review the complete slide order and caption.',{exact:true})).toBeVisible();
 const review=panel.getByRole('region',{name:'Review carousel',exact:true}),consent=review.getByRole('checkbox',{name:'I reviewed every saved slide, their order, alt text and the shared caption.',exact:true});
 await expect(review.getByText('Slide integrity check failed.',{exact:true})).toBeVisible();await expect(consent).toBeDisabled();await page.unroute(corruptPreview);await review.getByRole('button',{name:'Reload slide preview',exact:true}).click();
 await expect(review.getByRole('button',{name:'Send carousel for review',exact:true})).toBeDisabled();await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Send carousel for review',exact:true}).click();await expect(review.getByRole('button',{name:'Approve carousel',exact:true})).toBeVisible();await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Approve carousel',exact:true}).click();await expect(review.getByText('approved',{exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Move slide 2 up',exact:true}).click();await panel.getByRole('button',{name:'Save carousel',exact:true}).click();await expect(review.getByText('draft',{exact:true})).toBeVisible();await expect(review.getByRole('img').first()).toHaveAttribute('alt','Botanical slide 2');
 const id=await panel.getByLabel('Saved carousel',{exact:true}).inputValue();await page.reload();await panel.getByText('Carousels · compose and review slides',{exact:true}).click();await panel.getByLabel('Saved carousel',{exact:true}).selectOption(id);await expect(review.getByRole('img').first()).toHaveAttribute('alt','Botanical slide 2');
 await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/canvas-carousel-mobile.png',fullPage:true});
 const sibling=(await admin.query('SELECT id FROM app.brands WHERE organization_id=$1 AND id<>$2 LIMIT 1',[org,brand])).rows[0];assert.equal((await page.request.get(`${base}/api/v1/businesses/${sibling.id}/carousels/${id}`)).status(),404);
 assert.deepEqual(errors,[]);
});


test('Canvas generates an entire carousel, reopens it for editing and reviews saved slides after reload',async()=>{
 await page.setViewportSize({width:1280,height:900});await page.goto(`${base}/b/${brand}/canvas`);
 const panel=page.getByRole('region',{name:'Carousels',exact:true});await panel.getByText('Carousels · compose and review slides',{exact:true}).click();
 const generation=panel.getByRole('region',{name:'Generate a carousel',exact:true});
 await generation.getByLabel('Carousel idea',{exact:true}).fill('TEST a coordinated refill story');await generation.getByLabel('Number of carousel slides',{exact:true}).fill('2');
 await generation.getByRole('button',{name:'Generate carousel',exact:true}).click();
 await expect(generation.getByRole('button',{name:'Review generated carousel',exact:true})).toBeVisible({timeout:60000});
 await generation.getByRole('button',{name:'Review generated carousel',exact:true}).click();
 const review=panel.getByRole('region',{name:'Review carousel',exact:true});await expect(review.getByText('draft',{exact:true})).toBeVisible();await expect(review.getByRole('img')).toHaveCount(2);
 const consent=review.getByRole('checkbox',{name:'I reviewed every saved slide, their order, alt text and the shared caption.',exact:true});await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Send carousel for review',exact:true}).click();await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Approve carousel',exact:true}).click();await expect(review.getByText('approved',{exact:true})).toBeVisible();
 await page.reload();await panel.getByText('Carousels · compose and review slides',{exact:true}).click();await generation.getByRole('button',{name:'Review generated carousel',exact:true}).click();await expect(review.getByText('approved',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/canvas-generated-carousel-mobile.png',fullPage:true});
 const carouselDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'Download carousel ZIP',exact:true}).click();const savedBundle=await carouselDownload;assert.equal(savedBundle.suggestedFilename(),'desvio-carousel.zip');const bundleEntries=await readZip(await readFile(await savedBundle.path()));assert.deepEqual(bundleEntries.map(e=>e.name),['slide-01.png','slide-02.png','caption.txt','manifest.json']);const bundleManifest=JSON.parse(bundleEntries[3].bytes.toString());assert.equal(bundleManifest.status_at_download,'approved');assert.equal(bundleManifest.slides.length,2);
 await panel.getByText('Add carousel to calendar',{exact:true}).click();await panel.getByLabel(/^Carousel calendar time/).fill('2026-11-03T10:00');await panel.getByRole('button',{name:'Add saved carousel to calendar',exact:true}).click();await panel.getByRole('link',{name:'Open carousel in calendar',exact:true}).click();
 const postDetails=page.getByRole('region',{name:'Post details',exact:true});await expect(postDetails.getByRole('region',{name:'Review carousel',exact:true}).getByRole('img')).toHaveCount(2);
 await expect(postDetails.getByRole('button',{name:'Send for review',exact:true})).toBeEnabled();await postDetails.getByRole('button',{name:'Send for review',exact:true}).click();
 const slotId=new URL(page.url()).searchParams.get('slot');assert.ok(slotId);
 await page.goto(`${base}/b/${brand}/review?start=2026-11-03&slot=${slotId}`);await expect(postDetails.getByRole('button',{name:'Approve post',exact:true})).toBeEnabled();
 await postDetails.getByLabel('Feedback or creative direction',{exact:true}).fill('Please revisit the carousel order.');await postDetails.getByRole('button',{name:'Request changes',exact:true}).click();
 await waitFor(async()=>(await admin.query('SELECT state FROM app.content_slots WHERE id=$1',[slotId])).rows[0].state==='changes_requested');
 await postDetails.getByRole('button',{name:'Send for review',exact:true}).click();await postDetails.getByRole('button',{name:'Approve post',exact:true}).click();await waitFor(async()=>(await admin.query('SELECT state FROM app.content_slots WHERE id=$1',[slotId])).rows[0].state==='approved');
 await page.reload();await expect(postDetails.getByRole('button',{name:'Reopen review',exact:true})).toBeVisible();
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/carousel-calendar-review-mobile.png',fullPage:true});

 assert.deepEqual(errors,[]);
});
