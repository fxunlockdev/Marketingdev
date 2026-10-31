import {HiggsfieldReplacementJobs} from '../../dist/higgsfield-replacement-jobs.js';
import {HiggsfieldImageClient} from '../../dist/higgsfield-image-client.js';
import {ImageReplacementVault} from '../../dist/image-replacement-vault.js';
let replacementReady=false,replacementSubmits=0;const replacementRemote='5f2c4bd8-837c-44ca-9331-d01b02767180';
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
let videoSubmits=0,chatCalls=0;
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
  config.higgsfieldImagesEnabled=true;
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
  const replacements=new HiggsfieldReplacementJobs(jobs,new HiggsfieldImageClient({mode:'test',credentials:'MOCK'},async(url)=>{assert.equal(new URL(url).origin,'https://api.higgsfield.ai');if(String(url).includes('/estimate/'))return Response.json({usd:'0.0057'});if(String(url).endsWith('/status'))return Response.json({request_id:replacementRemote,status:replacementReady?'completed':'in_progress',...(replacementReady?{images:[{url:'https://public.example/replacement.png'}]}:{})});replacementSubmits++;return Response.json({request_id:replacementRemote,status:'queued'});}),new ImageReplacementVault('b'.repeat(64)),{fetch:async()=>({status:200,headers:{'content-type':'image/png'},bytes:await sharp({create:{width:1024,height:1024,channels:3,background:'#b3d9e8'}}).png().toBuffer()})});
  const provider = new CreativeProvider(
    undefined,
    new OpenAI({
      apiKey: "fixture-only",
      maxRetries: 0,
      fetch: async (url, init) => {
        if (String(url).startsWith("data:")) return fetch(url, init);
        if (new URL(url).pathname === "/v1/responses") {

          const chatWire=JSON.parse(init.body);
          if(chatWire.text?.format?.name==='desvio_chat'){
            chatCalls++;assert.equal(chatWire.model,'gpt-6-sol');
            const context=JSON.parse(chatWire.input.find(m=>m.role==='user').content);
            const recall=/remember/i.test(context.message),edit=/warmer/i.test(context.message),unclear=/something/i.test(context.message);
            return modelResponse({reply:recall?'I found your saved conversation.':unclear?'What should the image show?':edit?'I’ll warm up the saved image.':'I’ll create your clean image now.',action:recall||unclear?'answer':edit?'edit_image':'image',prompt:recall||unclear?'':'TEST a botanical soap image without text',channel:'instagram',size:'1024x1024',sources:recall?[context.memories[0].id]:[],starts_on:null,text_mode:edit?context.current_image.text_mode:'none'});
          }
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
          if(input.task==='content_plan'){const settings=input.planning_mode==='natural'?{duration_days:7,post_count:7,video_count:2}:null;return modelResponse(settings?{...generatedPlan({...input,...settings}),settings}:generatedPlan(input));}
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
        const requestedSize=new URL(url).pathname==='/v1/images/edits'?init.body.get('size'):JSON.parse(init.body).size;
        assert.ok(['1024x1024','1024x1536','1536x1024'].includes(requestedSize));
        const [width,height]=requestedSize.split('x').map(Number);
        const output=width===1024&&height===1024?png:await sharp({create:{width,height,channels:3,background:'#e6d5bb'}}).png().toBuffer();
        return Response.json({
          created: 1,
          data: [{ b64_json: output.toString("base64") }],
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
      generatePlan:carouselBeat(scope=>planner.run(scope)),
      failPlan:scope=>planner.fail(scope),
      generateCreative: async (scope) => {
        const context = Context.current(),
          timer = setInterval(() => context.heartbeat(), 1000);
        try {
          return await replacements.handles(scope)?await replacements.step(scope):await handler.run(scope);
        } finally {
          clearInterval(timer);
        }
      },
      failCreative: async (scope) => await replacements.handles(scope)?replacements.fail(scope):handler.fail(scope),
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
      await runtime.chatWorker.runOnce();
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
  await expect(page.getByRole("heading", { name: /^(Add your first business|Choose a business|Your content, at a glance\.)$/ })).toBeVisible();
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
afterEach(async()=>{
 await page.screenshot({path:'work/browser/canvas-latest-check.png',fullPage:true}).catch(()=>{});
 if(errors.length)console.error('BROWSER ERRORS',JSON.stringify(errors));
 if(brand){const pending=await admin.query("SELECT id,kind,status,error_code,attempt FROM app.jobs WHERE brand_id=$1 AND status NOT IN ('succeeded','canceled') ORDER BY created_at",[brand]);if(pending.rows.length)console.error('LOCAL TEST JOB DIAGNOSTICS',JSON.stringify(pending.rows));}
});

test("Canvas browser creates a real queued job, renders a private creative and saves editable Fabric layers (MOCK OpenAI)", async () => {
  await admin.query("INSERT INTO app.gemini_creative_grants(organization_id,brand_id,enabled,text_model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'gemini-fixture',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL BROWSER MOCK')",[org,brand]);
  const photoBytes=await sharp({create:{width:1440,height:900,channels:3,background:'#c4bca0'}}).jpeg().toBuffer();
  await page.goto(`${base}/b/${brand}/canvas`);
  await expect(page.getByText('Generation allowances',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Ready when you are.',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'+ New conversation',exact:true})).toBeEnabled();
  await expect(page.locator('#canvas-assets')).toBeHidden();
  assert.ok(await page.locator('.studio-composer').evaluate(el=>el.getBoundingClientRect().height<150));
  await page.screenshot({path:'work/browser/canvas-compact-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
  await page.screenshot({path:'work/browser/canvas-compact-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Create an image for my next launch',exact:false}).click();
  await expect(page.getByLabel('Describe your creative',{exact:true})).toHaveValue('Create an image for my next launch');
  await page.setViewportSize({width:1440,height:1000});

  await page.getByLabel('Creativity',{exact:true}).selectOption('creative');
  await expect(page.getByLabel('Creativity',{exact:true}).locator('option')).toHaveText(['Normal','Creative','Super creative']);
  await page.getByRole('button',{name:'Add assets',exact:true}).click();await page.getByText('Brand image references',{exact:true}).click();
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
    .getByRole("button", { name: "Send", exact: true })
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
  await page.getByLabel("Font", { exact: true }).selectOption("DM Serif Display");
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
  await expect(page.getByLabel("Font", { exact: true })).toHaveValue("DM Serif Display");
  await expect(page.getByLabel("Left position")).toHaveValue("80");
  const savedThreadURL=page.url();
  assert.ok(new URL(savedThreadURL).searchParams.get('thread'));
  await page.goto(`${base}/b/${brand}/canvas`);
  await expect(page.getByRole('heading',{name:'Ready when you are.',exact:true})).toBeVisible();
  await expect(page.getByLabel('Layer text')).toHaveCount(0);
  await page.getByText('Conversations',{exact:true}).click();
  await expect(page.getByRole('complementary',{name:'Conversations',exact:true}).getByRole('button').first()).toBeVisible();
  await page.goto(savedThreadURL);await page.reload();
  await expect(page.getByLabel('Layer text')).toHaveValue('Made for your everyday ritual');
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
  const artworkBounds=await page.locator('.studio-projects').boundingBox();
  const composerBounds=await page.locator('.studio-composer').boundingBox();
  assert.ok(artworkBounds && composerBounds && artworkBounds.y < composerBounds.y,'Saved artwork must appear before the conversation composer');
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
  const approvedImageThread=new URL(page.url()).searchParams.get('thread');
  assert.ok(approvedImageThread);
  await page.goto(`${base}/b/${brand}/canvas?thread=${approvedImageThread}&slot=${videoSlot.id}`);
  await expect(page.getByRole('region',{name:'Video calendar context'})).toBeVisible();
  await page.getByText('Make a video from this approved image',{exact:true}).click();
  await expect(page.getByLabel('Video idea',{exact:true})).toHaveValue(/TEST planned script/);
  await page.getByLabel('Video idea',{exact:true}).fill('TEST animate this brand image');
  await page.getByLabel('Video length (seconds)',{exact:true}).fill('3');
  await page.getByLabel('Video creativity',{exact:true}).selectOption('normal');
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
  const imageReturn=new URL(canvasURL);imageReturn.searchParams.delete('slot');
  await page.goto(imageReturn.href);



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
  try {
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.locator(".creative-project > .notice.error")).toContainText("couldn’t save");
  await expect(page.getByLabel("Layer text")).toHaveValue(
    "Unsaved browser work",
  );
  } finally { await page.unroute("**/creative-projects/*/versions"); }
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
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await expect(
    page.getByText("Needs reconciliation", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeDisabled();
  assert.equal(generated, 3);
  await page.reload();
  await expect(
    page.getByText("Needs reconciliation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
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
 await page.route('**/overview',async route=>{await delay(1200);await route.continue();});
 await page.goto(`${base}/b/${brand}/content-plan`);
 await page.getByRole('button',{name:'Create content plan',exact:true}).click();
 await page.getByLabel('Calendar view',{exact:true}).selectOption('month');
 await page.getByLabel('Plan starts on').fill('2026-11-01');
 await page.getByLabel('Anything to focus on?').fill('TEST FIXTURE: explain refillable soap');
 await page.getByRole('button',{name:'Generate draft plan',exact:true}).click();
 await expect(page.getByText('30 posts in this view',{exact:true})).toBeVisible({timeout:30000});
 await page.unroute('**/overview');
 await expect(page.getByLabel('Calendar date',{exact:true})).toHaveValue('2026-11-01');

 await expect(page.getByRole('button',{name:'Export calendar',exact:true})).toHaveCount(0);
 await page.screenshot({path:'work/browser/content-plan-desktop.png',fullPage:true});
 await page.locator('.calendar-filters > summary').click();
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
 await page.getByText('Brand image references',{exact:true}).click();
 await page.getByRole('checkbox',{name:'Botanical brand reference',exact:true}).check();
 const calendarReferenceUploads=referenceUploads;
 await page.getByRole('button',{name:'Create creative',exact:true}).click();
 await expect(page.getByRole('button',{name:'Send for review',exact:true})).toBeEnabled({timeout:30000});
 const postSlot=(await admin.query("SELECT s.* FROM app.content_slots s JOIN app.content_plans p ON p.id=s.plan_id WHERE s.brand_id=$1 AND s.hook='TEST FIXTURE hook 1'",[brand])).rows[0];
 assert.ok(postSlot.creative_version_id);assert.equal(postSlot.state,'draft_ready');
 assert.equal(referenceUploads,calendarReferenceUploads+1);
 await page.getByRole('button',{name:'Close post',exact:true}).click();
 await page.getByLabel('Calendar view',{exact:true}).selectOption('list');
 const thumbnail=page.locator('.plan-list-card').filter({has:page.getByText('TEST FIXTURE hook 1',{exact:true})}).locator('.post-thumbnail');
 await thumbnail.scrollIntoViewIfNeeded();
 await expect(thumbnail).toBeVisible();
 await expect(thumbnail.locator('image')).toHaveAttribute('href',/^blob:/);
 await thumbnail.click();
 await page.getByText('Edit topic & schedule',{exact:true}).click();
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
 await page.locator('.calendar-filters > summary').click();
 await page.getByRole('button',{name:'Instagram',exact:true}).click();await expect(page.getByText('Nothing waiting here',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'LinkedIn',exact:true}).click();await page.getByLabel('Select LinkedIn post: TEST FIXTURE hook 1').check();
 await expect(page.getByRole('button',{name:'Confirm bulk approval',exact:true})).toBeDisabled();await page.getByLabel('I have reviewed these 1 posts and approve their saved versions.').check();
 await page.getByRole('button',{name:'Confirm bulk approval',exact:true}).click();await expect(page.getByText('1 post approved. Nothing has been scheduled or published.',{exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT state FROM app.content_slots WHERE id=$1',[postSlot.id])).rows[0].state,'approved');
 await page.getByRole('button').filter({hasText:'TEST FIXTURE hook 1'}).click();await expect(page.getByRole('button',{name:'Revise creative',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Reopen review',exact:true}).click();
 await expect(page.getByRole('button',{name:'Approve post',exact:true})).toBeVisible();
 await page.reload();
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
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);
 await page.setViewportSize({width:1440,height:1000});assert.deepEqual(errors,[]);
});

test('Canvas manual edits require explicit approved-post reset; other businesses cannot see the saved plan or review',async()=>{
 const before=(await admin.query("SELECT * FROM app.content_slots WHERE brand_id=$1 AND hook='TEST FIXTURE hook 1'",[brand])).rows[0];
 await page.getByRole('link',{name:'Edit in Canvas',exact:true}).click();
 await page.getByLabel('Post caption').fill('TEST FIXTURE: Manual revision from review');
 await page.getByRole('button',{name:'Save new version',exact:true}).click();await expect(page.getByText('Saved as a new draft version.',{exact:true})).toBeVisible();
 await page.goto(`${base}/b/${brand}/review`);await page.getByLabel('Review from').fill('2026-11-01');
 await page.locator('.calendar-filters > summary').click();await page.getByRole('button').filter({hasText:'TEST FIXTURE hook 1'}).click();
 await expect(page.getByRole('button',{name:'Attach latest Canvas version',exact:true})).toBeDisabled();
 await expect(page.locator('.slot-caption')).not.toContainText('Manual revision from review');
 await page.getByText('Edit topic & schedule',{exact:true}).click();
 await page.getByLabel('I understand that changing this post resets approval and requires a new review.').check();
 await page.getByRole('button',{name:'Attach latest Canvas version',exact:true}).click();await expect(page.getByText('Latest Canvas version attached as an unapproved draft.',{exact:true})).toBeVisible();
 await expect(page.locator('.slot-caption')).toHaveText('TEST FIXTURE: Manual revision from review');
 const after=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[before.id])).rows[0];assert.equal(after.state,'draft_ready');assert.equal(after.approved_by,null);assert.notEqual(after.creative_version_id,before.creative_version_id);
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.content_slot_events WHERE slot_id=$1 AND action='approved'",[before.id])).rows[0].n,2);
 await page.getByRole('button',{name:'Edit design',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save design',exact:true})).toBeEnabled();
 await page.getByLabel('Layer text',{exact:true}).fill('TEST FIXTURE: Direct image edit');
 await page.getByLabel('Caption',{exact:true}).fill('TEST FIXTURE: Edited directly from the calendar');
 const editRoute=`**/content-slots/${before.id}`;
 await page.route(editRoute,route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'TEST attachment interruption'})}):route.continue());
 let retainedVersion;
 try {
   await page.getByRole('button',{name:'Save design',exact:true}).click();
   await expect(page.getByRole('button',{name:'Attach saved design',exact:true})).toBeEnabled();
   retainedVersion=(await admin.query('SELECT p.latest_version_id FROM app.creative_projects p JOIN app.creative_versions v ON v.project_id=p.id WHERE v.id=$1',[after.creative_version_id])).rows[0].latest_version_id;
 } finally {await page.unroute(editRoute);}
 await page.getByRole('button',{name:'Attach saved design',exact:true}).click();
 await expect(page.getByText('Design saved. Your updated post is ready for review.',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.locator('.slot-caption')).toHaveText('TEST FIXTURE: Edited directly from the calendar');
 const inlineSaved=(await admin.query('SELECT * FROM app.content_slots WHERE id=$1',[before.id])).rows[0];
 assert.notEqual(inlineSaved.creative_version_id,after.creative_version_id);assert.equal(inlineSaved.creative_version_id,retainedVersion,'Attachment retry must retain the saved version');assert.equal(inlineSaved.state,'draft_ready');
 await page.getByRole('button',{name:'Edit design',exact:true}).click();
 await expect(page.getByLabel('Layer text',{exact:true})).toHaveValue('TEST FIXTURE: Direct image edit');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel editing',exact:true}).click();
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:'work/browser/calendar-inline-editor-saved.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:'work/browser/calendar-post-mobile.png',fullPage:true});
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.setViewportSize({width:1440,height:1000});
 const other=(await admin.query("SELECT id FROM app.brands WHERE organization_id=$1 AND name='OTHER BUSINESS'",[org])).rows[0].id;
 await page.goto(`${base}/b/${other}/content-plan`);await page.getByLabel('Calendar date').fill('2026-11-01');await expect(page.getByText('Space for your next ideas',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Post details',exact:true})).toHaveCount(0);
 const denied=await page.request.get(`${base}/api/v1/businesses/${other}/content-slots/${before.id}`);assert.equal(denied.status(),404);assert.deepEqual(errors,[]);
});

test('Canvas creates a custom four-day plan and opens its actual saved calendar post',async()=>{
 const businesses=new Businesses(runtime.database,new Workspaces(runtime.database));
 const preferences=await businesses.onboarding(actor,brand);
 if(preferences.step!==3)await businesses.onboarding(actor,brand,{revision:preferences.revision,step:3,goal:'awareness',timezone:'Asia/Kuala_Lumpur',cadence:3,channels:['linkedin','instagram'],must_avoid:'No unsupported claims',preferences_edited:true});
 await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,provider,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,'openai',true,'MOCK-plan',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL BROWSER TEST ONLY') ON CONFLICT (organization_id,brand_id,provider) DO UPDATE SET enabled=true,budget_micros=10000000",[org,brand]);
 await page.goto(`${base}/b/${brand}/canvas`);
 await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
 await page.getByText('Plan content in Canvas',{exact:true}).click();
 await page.getByRole('button',{name:'Plan settings',exact:true}).click();
 await page.getByLabel('Plan creativity',{exact:true}).selectOption('normal');
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
 const saved=(await admin.query("SELECT id,duration_days FROM app.content_plans WHERE brand_id=$1 AND starts_on='2026-12-01'",[brand])).rows[0];assert.equal(saved.duration_days,4);assert.equal((await admin.query('SELECT provider FROM app.planning_requests WHERE output_plan_id=$1',[saved.id])).rows[0].provider,'openai');
 // Explicit validated-image fixture; uploads and scanner normalization are tested separately.
 const assetId=randomUUID(),visualId=randomUUID(),captureId=randomUUID();
 const jpg=await sharp({create:{width:640,height:480,channels:3,background:'#a6b98a'}}).jpeg().toBuffer(),sha=digest(jpg),objectKey=`evidence/${org}/${brand}/campaign-reference/${sha}`;
 await store.persist(objectKey,jpg,'image/jpeg',sha);
 await admin.query("INSERT INTO app.assets(id,organization_id,brand_id,created_by,filename,content_type,expected_bytes,sha256,quarantine_key,canonical_key,state) VALUES($1,$2,$3,$4,'CAMPAIGN FIXTURE.jpg','image/jpeg',$5,$6,$7,$8,'ready')",[assetId,org,brand,actor,jpg.length,sha,objectKey+'-quarantine',objectKey]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,asset_id,requested_by,kind,status) VALUES($1,$2,$3,$4,$5,'asset.validate','succeeded')",[captureId,org,brand,assetId,actor]);
 await admin.query('INSERT INTO app.uploaded_visuals(id,organization_id,brand_id,asset_id,job_id,object_key,sha256,source_sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,640,480)',[visualId,org,brand,assetId,captureId,objectKey,sha,jpg.length]);
 const approved=await post(`/api/v1/businesses/${brand}/canvas/references`,{kind:'upload',visual_id:visualId,label:'Campaign photo',consent:true},randomUUID());assert.equal(approved.status,201);
 await admin.query('INSERT INTO app.generation_plans(organization_id,monthly_price_usd,enabled) VALUES($1,800,true) ON CONFLICT(organization_id) DO UPDATE SET monthly_price_usd=800,enabled=true',[org]);
 const stylePage=await page.context().newPage();
 try{
  await stylePage.goto(`${base}/b/${brand}/campaign-new`);await expect(stylePage.locator('.generation-balance summary')).toContainText('credits');await stylePage.locator('.generation-balance summary').click();await expect(stylePage.locator('.generation-balance-detail')).toContainText('16,000 credits used');await expect(stylePage.locator('.generation-balance-detail')).toContainText('Shared across your businesses');await stylePage.locator('.generation-balance summary').click();await stylePage.getByLabel('Campaign name',{exact:true}).fill('Everyday, thoughtfully made');await stylePage.getByLabel('Theme',{exact:true}).fill('Introduce the everyday collection.');
  await stylePage.getByRole('button',{name:'Continue',exact:true}).click();
  await stylePage.getByLabel('Start date',{exact:true}).fill('2028-02-01');await stylePage.getByRole('button',{name:'Use monthly mix',exact:true}).click();await expect(stylePage.getByLabel('Image posts',{exact:true})).toHaveValue('15');await expect(stylePage.getByLabel('Video posts',{exact:true})).toHaveValue('3');await stylePage.getByRole('group',{name:'Choose a platform',exact:true}).getByRole('button',{name:'Instagram',exact:true}).click();await expect(stylePage.getByLabel('Image posts',{exact:true})).toHaveValue('14');await expect(stylePage.getByLabel('Reels',{exact:true})).toHaveValue('2');await expect(stylePage.getByLabel('Duration',{exact:true})).toHaveValue('29');await expect(stylePage.getByText('34 posts over 29 days',{exact:false})).toBeVisible();
  await stylePage.getByLabel('Image posts',{exact:true}).fill('13');await stylePage.getByRole('button',{name:'Back',exact:true}).click();await stylePage.getByRole('button',{name:'Continue',exact:true}).click();await stylePage.getByRole('group',{name:'Choose a platform',exact:true}).getByRole('button',{name:'Instagram',exact:true}).click();await expect(stylePage.getByLabel('Image posts',{exact:true})).toHaveValue('13');await stylePage.getByRole('button',{name:'Use monthly mix',exact:true}).click();
  await stylePage.screenshot({path:'work/browser/campaign-monthly-mix.png',fullPage:true});
  await stylePage.getByRole('button',{name:'Continue',exact:true}).click();
  await stylePage.getByLabel('Preview image',{exact:true}).selectOption(approved.body.id);await expect(stylePage.getByLabel('Preview image',{exact:true})).toHaveValue(approved.body.id);await stylePage.locator('.campaign-design-choice').last().scrollIntoViewIfNeeded();
  await expect.poll(()=>stylePage.locator('.campaign-design-preview img').count()).toBe(4);assert.ok(await stylePage.locator('.campaign-design-preview img').evaluateAll(images=>images.every(image=>image.naturalWidth>0)));
  await stylePage.getByRole('radio',{name:'Editorial',exact:true}).check();await stylePage.evaluate(()=>scrollTo(0,0));await stylePage.screenshot({path:'work/browser/campaign-photo-styles.png',fullPage:true});
  await stylePage.getByRole('button',{name:'Continue',exact:true}).click();await stylePage.getByRole('radio',{name:'Classic',exact:true}).check();await expect(stylePage.getByLabel('Preview image',{exact:true})).toHaveValue(approved.body.id);
  await stylePage.setViewportSize({width:390,height:844});await stylePage.locator('.campaign-design-choice').last().scrollIntoViewIfNeeded();await expect.poll(()=>stylePage.locator('.campaign-design-preview img').count()).toBe(3);
  assert.ok(await stylePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page:stylePage}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);await stylePage.evaluate(()=>scrollTo(0,0));await stylePage.screenshot({path:'work/browser/campaign-photo-fonts-mobile.png',fullPage:true});
  await stylePage.getByRole('button',{name:'Back',exact:true}).click();await expect(stylePage.getByRole('radio',{name:'Editorial',exact:true})).toBeChecked();
 }finally{await stylePage.close();await page.bringToFront();}
 const editableIds=await preview.locator('[data-slot-id]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-slot-id')));
 const topicSlotId=(await admin.query("SELECT id FROM app.content_slots WHERE brand_id=$1 AND id=ANY($2::uuid[]) AND format='static' ORDER BY planned_at LIMIT 1",[brand,editableIds])).rows[0]?.id;assert.ok(topicSlotId);
 const topicCard=preview.locator(`[data-slot-id="${topicSlotId}"]`);
 await topicCard.getByRole('button',{name:'Edit topic',exact:true}).click();
 await topicCard.getByLabel('Post topic',{exact:true}).fill('TEST revised campaign topic');
 await topicCard.getByRole('checkbox',{name:'Campaign photo',exact:true}).check();
 await expect(topicCard.getByRole('img',{name:'Campaign photo',exact:true})).toBeVisible();
 await expect(page.getByLabel('Saved content plan',{exact:true})).toBeDisabled();
 await topicCard.getByRole('button',{name:'Save topic',exact:true}).click();
 await expect(preview.getByRole('status').filter({hasText:'Topic saved.'})).toBeVisible();
 const topicRow=(await admin.query('SELECT * FROM app.content_slots WHERE plan_id=$1 AND brief=$2',[saved.id,'TEST revised campaign topic'])).rows[0];assert.ok(topicRow);assert.equal(topicRow.state,'content_needed');assert.deepEqual(topicRow.reference_ids,[approved.body.id]);
 await topicCard.getByRole('button',{name:'Edit topic',exact:true}).click();
 await topicCard.getByLabel('Post topic',{exact:true}).fill('TEST draft retained after conflict');
 const concurrent=await page.evaluate(async ({brand,id,revision})=>{const response=await fetch(`/api/v1/businesses/${brand}/content-slots/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({revision,brief:'TEST newer topic from another session'})});return {status:response.status,body:await response.json()};},{brand,id:topicRow.id,revision:topicRow.revision});assert.equal(concurrent.status,200,JSON.stringify(concurrent.body));
 await topicCard.getByRole('button',{name:'Save topic',exact:true}).click();
 await expect(topicCard.getByRole('alert')).toContainText('This post changed');
 await expect(topicCard.getByLabel('Post topic',{exact:true})).toHaveValue('TEST draft retained after conflict');
 await topicCard.getByRole('button',{name:'Compare with latest saved topic',exact:true}).click();
 await expect(topicCard.getByText('TEST newer topic from another session',{exact:true})).toBeVisible();
 await expect(topicCard.getByLabel('Post topic',{exact:true})).toHaveValue('TEST draft retained after conflict');
 await topicCard.getByRole('button',{name:'Cancel',exact:true}).click();

 await page.reload();await expect(page.getByText('Campaign posts',{exact:true})).toBeVisible();await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(4);
 await expect(preview).toContainText('TEST newer topic from another session');
 await expect(preview).toContainText('1 reference image selected');
 await preview.getByRole('group',{name:'Selected reference images'}).scrollIntoViewIfNeeded();
 await expect(preview.getByRole('group',{name:'Selected reference images'}).getByRole('img',{name:'Campaign photo',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Creating your content plan',exact:true})).toHaveCount(0);
 const topicContrast=await topicCard.evaluate(element=>{const luminance=(colour)=>colour.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);const background=luminance(getComputedStyle(element).backgroundColor),foreground=luminance(getComputedStyle(element.querySelector('.planned-topic')).color);return (Math.max(background,foreground)+0.05)/(Math.min(background,foreground)+0.05);});assert.ok(topicContrast>=4.5,`Topic text contrast must be at least 4.5:1, got ${topicContrast}`);
 await page.screenshot({path:'work/browser/campaign-saved-references.png',fullPage:true});
 const revoked=await post(`/api/v1/businesses/${brand}/canvas/references/${approved.body.id}/revoke`,{});assert.equal(revoked.status,201);
 await topicCard.getByRole('button',{name:'Edit topic',exact:true}).click();
 await topicCard.getByRole('button',{name:'Remove unavailable image 1',exact:true}).click();
 await topicCard.getByRole('button',{name:'Save topic',exact:true}).click();
 await expect(topicCard.getByRole('status')).toHaveText('Topic saved.');
 assert.deepEqual((await admin.query('SELECT reference_ids FROM app.content_slots WHERE id=$1',[topicRow.id])).rows[0].reference_ids,[]);
 await page.getByText('Conversation & planning notes',{exact:true}).click();
 await expect(page.getByRole('list',{name:'Conversation messages'})).toContainText('TEST four-day launch sequence');
 await expect(page.getByRole('list',{name:'Conversation messages'})).toContainText('Prepared 4 draft posts');
 await expect(page.getByRole('region',{name:'Conversation plans'}).getByRole('link',{name:'Open calendar · 2026-12-01'})).toBeVisible();
 await expect(page.getByRole('region',{name:'Planning loops'})).toContainText('1 of 3 plans prepared');
 await page.getByRole('button',{name:'Stop planning loop',exact:true}).click();
 await expect(page.getByRole('region',{name:'Planning loops'})).toContainText('Stopped');
 const loopRow=(await admin.query('SELECT l.* FROM app.planning_loops l JOIN app.planning_requests r ON r.loop_id=l.id WHERE r.output_plan_id=$1',[saved.id])).rows[0];assert.ok(loopRow.stopped_at);assert.equal(Number(loopRow.budget_micros),5000000);
 await page.screenshot({path:'work/browser/canvas-planning-loop.png',fullPage:true});
 const imageBatch=preview.getByRole('region',{name:'Create campaign images',exact:true});
 let progressFailures=0;
 await page.route(`**/content-plans/${saved.id}/image-batch`,async route=>{
  if(progressFailures===0){progressFailures++;await route.fulfill({status:503,contentType:'application/json',body:'{}'});}
  else await route.continue();
 });
 await page.reload();
 await expect(imageBatch.getByRole('button',{name:'Generate 2 images',exact:true})).toBeEnabled({timeout:15000});
 assert.equal(progressFailures,1);
 await page.unroute(`**/content-plans/${saved.id}/image-batch`);
 await imageBatch.getByRole('button',{name:'Generate 2 images',exact:true}).click();
 await expect(imageBatch.getByRole('status')).toContainText('2 of 2 posts ready',{timeout:60000});
 const imageJobs=(await admin.query('SELECT job_ids FROM app.campaign_image_batches WHERE plan_id=$1',[saved.id])).rows;assert.equal(imageJobs.length,1);assert.equal(imageJobs[0].job_ids.length,2);
 await page.reload();await expect(page.getByText('Campaign posts',{exact:true})).toBeVisible();await expect(imageBatch.getByRole('status')).toContainText('2 of 2 posts ready');
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.content_slot_generations g JOIN app.content_slots s ON s.id=g.slot_id WHERE s.plan_id=$1',[saved.id])).rows[0].n,2);
 await preview.getByRole('listitem').last().scrollIntoViewIfNeeded();await expect(preview.locator('.post-thumbnail svg')).toHaveCount(2,{timeout:15000});
 await imageBatch.scrollIntoViewIfNeeded();await page.screenshot({path:'work/browser/campaign-image-batch.png',fullPage:true});

 const campaignUrl=page.url();
 let campaignReadAttempts=0;
 await page.route(`**/content-plans/${saved.id}`,async route=>{
  campaignReadAttempts++;
  if(campaignReadAttempts===1){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporarily unavailable'})});return;}
  await route.continue();
 });
 const planningCountBefore=(await admin.query('SELECT count(*)::int AS n FROM app.planning_requests WHERE output_plan_id=$1',[saved.id])).rows[0].n;
 await page.goto(`${base}/b/${brand}/campaign-review?plan=${saved.id}`);
 await expect(page.getByRole('status').filter({hasText:'Reconnecting'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Your campaign',exact:true,level:1})).toBeVisible({timeout:15000});
 assert.equal(campaignReadAttempts,2);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.planning_requests WHERE output_plan_id=$1',[saved.id])).rows[0].n,planningCountBefore);
 await page.unroute(`**/content-plans/${saved.id}`);
 await expect(page.getByRole('heading',{name:'Your campaign',exact:true,level:1})).toBeVisible();
 assert.deepEqual((await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link').allTextContents()).slice(0,9).map(s=>s.trim()),['Home','Calendar','Campaigns','Integrations','Brand Kit','Content Preferences','Approvals','Learnings','Insights']);
 await expect(page.getByRole('list',{name:'Campaign posts'}).getByRole('listitem')).toHaveCount(4);
 await expect(page.locator('.campaign-preview-grid .post-thumbnail svg')).toHaveCount(2,{timeout:15000});
 await expect(page.getByRole('link',{name:'Review post',exact:true})).toHaveCount(2);
 await expect(page.getByRole('list',{name:'Conversation messages'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await page.screenshot({path:'work/browser/dedicated-campaign-review-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('link',{name:'Review post',exact:true}).first().click();
 const focused=page.getByRole('region',{name:'Post details',exact:true});
 await expect(focused.getByRole('region',{name:'Creative preview',exact:true})).toBeVisible();
 await expect(page.getByLabel('Calendar date',{exact:true})).toHaveCount(0);
 await expect(focused.getByLabel('Creative brief',{exact:true})).not.toBeVisible();
 await expect(focused.getByRole('button',{name:'Send for review',exact:true})).toBeEnabled();
 await page.screenshot({path:'work/browser/focused-post-review-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await page.screenshot({path:'work/browser/focused-post-review-mobile.png',fullPage:true});
 await focused.getByRole('button',{name:'Close post',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Calendar',exact:true,level:1})).toBeFocused();
 assert.equal(new URL(page.url()).searchParams.has('slot'),false);
 await page.setViewportSize({width:1440,height:1000});
 await page.getByLabel('Calendar view',{exact:true}).selectOption('week');
 await expect(page.locator('.calendar-activity')).not.toHaveAttribute('open');
 await expect(page.locator('.plan-grid-week .plan-day')).toHaveCount(7);
 await expect(page.locator('.plan-grid-week .post-thumbnail svg')).toHaveCount(2,{timeout:15000});
 assert.ok(await page.locator('.plan-grid-week .plan-card').first().evaluate(el=>el.getBoundingClientRect().width>=240));
 await expect(page.getByLabel('Post status',{exact:true})).not.toBeVisible();
 await page.locator('.calendar-filters > summary').click();
 await expect(page.getByLabel('Post status',{exact:true})).toBeVisible();
 await page.getByLabel('Post status',{exact:true}).selectOption('draft_ready');
 await expect(page.locator('.calendar-filters > summary')).toContainText('Active');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(page.getByLabel('Post status',{exact:true})).toHaveValue('');
 await page.locator('.calendar-filters > summary').click();
 await expect(page.locator('.plan-grid-week .post-thumbnail svg')).toHaveCount(2,{timeout:15000});
 await page.screenshot({path:'work/browser/calendar-week-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await page.screenshot({path:'work/browser/calendar-week-mobile.png',fullPage:true});
 const overviewRoute=`**/api/v1/businesses/${brand}/overview`;let overviewFailures=0;
 await page.route(overviewRoute,async route=>{if(overviewFailures++===0)return route.fulfill({status:503,json:{message:'TEST temporary overview failure'}});return route.continue();});
 await page.goto(`${base}/b/${brand}/overview`);await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Upcoming posts',exact:true})).toBeVisible();await page.unroute(overviewRoute);
 await expect(page.locator('.upcoming-post')).not.toHaveCount(0);
 assert.ok(await page.locator('.upcoming-copy h3').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).webkitLineClamp==='2')));
 const readyHomePost=page.locator('.upcoming-post').filter({hasText:'Draft ready'}).first();
 await readyHomePost.scrollIntoViewIfNeeded();
 const homeCreative=readyHomePost.locator('.post-thumbnail svg, .post-thumbnail img').first();
 await expect(homeCreative).toBeVisible({timeout:15000});
 await expect.poll(()=>homeCreative.evaluate(node=>node instanceof HTMLImageElement?node.complete&&node.naturalWidth>0:!!node.querySelector('image')?.getAttribute('href'))).toBeTruthy();
 assert.ok(await homeCreative.evaluate(node=>{const box=node instanceof HTMLImageElement?{width:node.naturalWidth,height:node.naturalHeight}:node.viewBox.baseVal;const ratio=node.parentElement.style.aspectRatio.split('/').map(Number);return ratio.length===2&&Math.abs(ratio[0]/ratio[1]-box.width/box.height)<0.01;}));

 await expect(page.locator('.workspace-switcher').getByRole('combobox',{name:'Business',exact:true})).toHaveValue(brand);
 await expect(page.locator('.workspace-page-title')).toContainText('Welcome back,');
 await expect(page.getByRole('link',{name:'View calendar',exact:true})).toHaveAttribute('href',`/b/${brand}/content-plan`);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await page.screenshot({path:'work/browser/workspace-home-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Menu',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Brand Kit',exact:true})).toBeVisible();
 await page.setViewportSize({width:1440,height:1000});
 await expect(page.locator('.v5-topbar').getByRole('link',{name:'Profile',exact:true})).toBeVisible();
 await page.screenshot({path:'work/browser/workspace-home-desktop.png',fullPage:true});
 await page.goto(campaignUrl);
 await preview.getByRole('link',{name:'Edit or review this post',exact:true}).first().click();
 await expect(page.getByLabel('Calendar date',{exact:true})).toHaveCount(0);
 assert.equal(new URL(page.url()).searchParams.get('start'),'2026-12-01');
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
 const sourceThread=(await admin.query('SELECT thread_id FROM app.planning_requests WHERE output_plan_id=$1',[original.id])).rows[0].thread_id;
 await page.goto(`${base}/b/${brand}/canvas?thread=${sourceThread}`);await page.getByText('Plan content in Canvas',{exact:true}).click();
 await page.getByLabel('Describe your creative',{exact:true}).fill('TEST: Make this a weekly plan with two videos and keep my edited script direction');
 await page.getByLabel('Plan starts on (optional)',{exact:true}).fill('2027-02-01');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const preview=page.getByRole('region',{name:'Planned posts',exact:true});await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(7,{timeout:60000});await expect(preview).toContainText('7 days · 7 posts · 2 videos');
 const request=(await admin.query("SELECT input,output_plan_id FROM app.planning_requests WHERE brand_id=$1 AND input->>'planning_mode'='natural' AND input->'preferences'->>'starts_on'='2027-02-01'",[brand])).rows[0];
 assert.equal(request.input.reference_plan.id,original.id);assert.ok(request.input.reference_plan.slots.some(s=>s.video_draft?.prompt==='TEST edited calendar video prompt'));assert.ok(request.output_plan_id);
 assert.deepEqual((await admin.query('SELECT id,revision,video_draft FROM app.content_slots WHERE plan_id=$1 ORDER BY planned_at,id',[original.id])).rows,before);
 // A slow initial conversation fetch must not replace an already-open planner.
 await page.route('**/canvas/threads',async route=>{await delay(600);await route.continue();});
 await page.reload();await expect(page.getByText('Campaign posts',{exact:true})).toBeVisible();await expect(preview.getByRole('list',{name:'Day-by-day posts'}).getByRole('listitem')).toHaveCount(7);
 await page.unroute('**/canvas/threads');
 await page.getByText('Conversation & planning notes',{exact:true}).click();
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
  assert.deepEqual((await new AxeBuilder({page:reviewPage}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);
 }finally{await context.close();}
});

test('Canvas composes generated slides as one carousel, reviews exact pixels, reorders into a new draft and survives reload',async()=>{
 await page.goto(`${base}/b/${brand}/canvas`);const root=`/api/v1/businesses/${brand}`;const slides=[];
 for(let i=0;i<2;i++){
  const t=await post(root+'/canvas/threads',{title:`TEST carousel slide ${i+1}`},randomUUID());assert.equal(t.status,201);
  const j=await post(root+`/canvas/threads/${t.body.id}/messages`,{prompt:`TEST carousel slide ${i+1}: botanical soap story`,format:'static',channel:'linkedin',size:'1024x1024',parent_version_id:null},randomUUID());assert.equal(j.status,201);
  let slideJob;
  try { await waitFor(async()=> {
    slideJob=(await admin.query('SELECT status,error_code FROM app.jobs WHERE id=$1',[j.body.id])).rows[0];
    assert.ok(!['failed','cancelled'].includes(slideJob.status),`Slide generation failed: ${JSON.stringify(slideJob)}`);
    return slideJob.status==='succeeded';
  }); } catch(error) { throw new Error(`Carousel source image did not complete: ${JSON.stringify(slideJob)}`,{cause:error}); }
  const v=(await admin.query('SELECT v.id,v.sha256 FROM app.creative_requests r JOIN app.creative_versions v ON v.id=r.output_version_id WHERE r.job_id=$1',[j.body.id])).rows[0];
  const e=await post(root+`/creative-versions/${v.id}/exports`,{source_sha256:v.sha256},randomUUID());assert.equal(e.status,201);
  await waitFor(async()=> (await admin.query('SELECT count(*)::int AS n FROM app.creative_exports WHERE version_id=$1',[v.id])).rows[0].n===1);
  slides.push((await admin.query('SELECT id FROM app.creative_exports WHERE version_id=$1',[v.id])).rows[0].id);
 }
 await page.reload();await page.getByText('Options',{exact:true}).click();await page.getByRole('button',{name:'Combine saved images into a carousel',exact:true}).click();const panel=page.getByRole('region',{name:'Carousels',exact:true});
 await panel.getByLabel('Carousel title',{exact:true}).fill('TEST botanical story');await panel.getByLabel('Shared carousel caption',{exact:true}).fill('A single story across two slides.');
 for(let i=0;i<2;i++){await panel.getByRole('button',{name:'Add slide',exact:true}).click();await panel.getByLabel(`Saved image for slide ${i+1}`,{exact:true}).selectOption(slides[i]);await panel.getByLabel(`Alt text for slide ${i+1}`,{exact:true}).fill(`Botanical slide ${i+1}`);}
 const corruptPreview='**/creative-exports/'+slides[0]+'/download';await page.route(corruptPreview,async route=>{const response=await route.fetch(),grant=await response.json();await route.fulfill({response,json:{...grant,sha256:'0'.repeat(64)}});});
 await panel.getByRole('button',{name:'Save carousel',exact:true}).click();await expect(panel.getByText('Carousel saved as a draft. Review the complete slide order and caption.',{exact:true})).toBeVisible();
 const review=panel.getByRole('region',{name:'Review carousel',exact:true}),consent=review.getByRole('checkbox',{name:'I reviewed every saved slide, their order, alt text and the shared caption.',exact:true});
 await expect(review.getByText('Slide integrity check failed.',{exact:true})).toBeVisible();await expect(consent).toBeDisabled();await page.unroute(corruptPreview);await review.getByRole('button',{name:'Reload slide preview',exact:true}).click();
 await expect(review.getByRole('button',{name:'Send carousel for review',exact:true})).toBeDisabled();await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Send carousel for review',exact:true}).click();await expect(review.getByRole('button',{name:'Approve carousel',exact:true})).toBeVisible();await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Approve carousel',exact:true}).click();await expect(review.getByText('approved',{exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'Move slide 2 up',exact:true}).click();await panel.getByRole('button',{name:'Save carousel',exact:true}).click();await expect(review.getByText('draft',{exact:true})).toBeVisible();await expect(review.getByRole('img').first()).toHaveAttribute('alt','Botanical slide 2');
 const id=await panel.getByLabel('Saved carousel',{exact:true}).inputValue();await page.reload();await panel.getByText('Carousels · compose and review slides',{exact:true}).click();await panel.getByLabel('Saved carousel',{exact:true}).selectOption(id);await expect(review.getByRole('img').first()).toHaveAttribute('alt','Botanical slide 2');
 await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/canvas-carousel-mobile.png',fullPage:true});
 const sibling=(await admin.query('SELECT id FROM app.brands WHERE organization_id=$1 AND id<>$2 LIMIT 1',[org,brand])).rows[0]??(await post('/api/v1/businesses',{name:'Carousel isolation test'},randomUUID())).body;assert.equal((await page.request.get(`${base}/api/v1/businesses/${sibling.id}/carousels/${id}`)).status(),404);
 assert.deepEqual(errors,[]);
});


test('Canvas generates an entire carousel, reopens it for editing and reviews saved slides after reload',async()=>{
 await page.setViewportSize({width:1280,height:900});await page.goto(`${base}/b/${brand}/canvas`);
 const panel=page.getByRole('region',{name:'Carousels',exact:true});
 const generation=panel.getByRole('region',{name:'Generate a carousel',exact:true});
 const composer=page.getByRole('region',{name:'Creative conversation',exact:true});await composer.getByLabel('Describe your creative',{exact:true}).fill('TEST create a carousel with a coordinated refill story');await composer.getByLabel('Slides',{exact:true}).fill('2');await composer.getByLabel('Creativity',{exact:true}).selectOption('super');
 await composer.getByRole('button',{name:'Send',exact:true}).click();
 await expect(generation.getByRole('button',{name:'Review generated carousel',exact:true})).toBeVisible({timeout:60000});
 await generation.getByRole('button',{name:'Review generated carousel',exact:true}).click();
 const review=panel.getByRole('region',{name:'Review carousel',exact:true});await expect(review.getByText('draft',{exact:true})).toBeVisible();await expect(review.getByRole('img')).toHaveCount(2);
 const consent=review.getByRole('checkbox',{name:'I reviewed every saved slide, their order, alt text and the shared caption.',exact:true});await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Send carousel for review',exact:true}).click();await expect(consent).toBeEnabled();await consent.check();await review.getByRole('button',{name:'Approve carousel',exact:true}).click();await expect(review.getByText('approved',{exact:true})).toBeVisible();
 await page.reload();await panel.getByText('Carousels · compose and review slides',{exact:true}).click();await generation.getByRole('button',{name:'Review generated carousel',exact:true}).click();await expect(review.getByText('approved',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/canvas-generated-carousel-mobile.png',fullPage:true});
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
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/carousel-calendar-review-mobile.png',fullPage:true});
 await postDetails.getByRole('button',{name:'Close post',exact:true}).click();
 await page.goto(`${base}/b/${brand}/content-plan?start=2026-11-03`);
 const carouselCover=page.locator('.daily-post .post-cover');
 await expect(carouselCover).toBeVisible();await expect.poll(()=>carouselCover.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 const coverPixels=await carouselCover.evaluate(img=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png').split(',')[1];});
 assert.deepEqual(await sharp(Buffer.from(coverPixels,'base64')).ensureAlpha().raw().toBuffer(),await sharp(bundleEntries[0].bytes).ensureAlpha().raw().toBuffer());
 await page.screenshot({path:'work/browser/carousel-calendar-cover.png',fullPage:true});


 assert.deepEqual(errors,[]);
});

test('staging creative acceptance runner exercises real customer APIs and pauses for exact-version human review',async()=>{
 const {creativeAcceptance}=await import('../../scripts/live/creative-acceptance.mjs');
 const foreignContext=await browser.newContext(),anonymousContext=await browser.newContext();
 const email=randomUUID()+'@example.test',password='live-harness-LOCAL-fixture-password';
 const call=context=>async(path,body,key,method)=>{const r=await context.request.fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{origin:base,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},data:body});return {status:r.status(),body:await r.json()};};
 try{
  await admin.query('DELETE FROM auth."rateLimit"');
  const foreign=call(foreignContext),signed=await foreign('/api/auth/sign-up/email',{name:'Foreign acceptance fixture',email,password});assert.equal(signed.status,200);
  await admin.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1',[signed.body.user.id]);assert.equal((await foreign('/api/auth/sign-in/email',{email,password})).status,200);
  const state={runId:randomUUID()},settings={organizationId:org,businessId:brand,budgetMicros:10000000};let saved;
  const io={api:call(page.context()),foreign,anonymous:call(anonymousContext),media:async url=>Buffer.from(await (await fetch(url)).arrayBuffer()),save:async s=>{saved=JSON.parse(JSON.stringify(s));},wait:delay};
  const before=generated,realApi=io.api;let lostResponse=false;
  io.api=async(...args)=>{const result=await realApi(...args);if(!lostResponse&&args[0].endsWith('/messages')&&result.status>=200&&result.status<300){lostResponse=true;throw Error('LOCAL_RESPONSE_LOST');}return result;};
  await assert.rejects(creativeAcceptance(io,settings,state),/LOCAL_RESPONSE_LOST/);assert.ok(lostResponse);assert.equal(saved.create.jobId,undefined);
  io.api=realApi;Object.assign(state,JSON.parse(JSON.stringify(saved)));
  const paused=await creativeAcceptance(io,settings,state);assert.equal(paused.status,'awaiting_human_approval');assert.equal(generated,before+2);assert.equal(saved.manualVersionId,paused.reviewVersionId);
  assert.equal(Number((await admin.query('SELECT count(*) AS n FROM app.creative_requests WHERE thread_id=$1',[state.threadId])).rows[0].n),2);
  const project=(await io.api(`/api/v1/businesses/${brand}/creative-projects/${state.edit.projectId}`)).body,version=project.versions.find(v=>v.id===state.manualVersionId);
  assert.equal((await io.api(`/api/v1/businesses/${brand}/creative-versions/${version.id}/review`,{decision:'approved',revision:version.review_revision,feedback:'LOCAL test reviewer acceptance'})).status,201);
  const resumed=await creativeAcceptance(io,settings,JSON.parse(JSON.stringify(saved)));assert.equal(resumed.status,'passed');assert.equal(generated,before+2);
  const reserved=(await admin.query('SELECT sum(reserved_micros)::bigint AS n FROM app.creative_calls WHERE job_id=ANY($1::uuid[])',[[state.create.jobId,state.edit.jobId]])).rows[0].n;assert.ok(Number(reserved)<=settings.budgetMicros);
 }finally{await foreignContext.close();await anonymousContext.close();}
});

test('uploaded product photo starts video without static generation, then feedback regenerates through prompt approval (MOCK providers)',async()=>{
 await admin.query("INSERT INTO app.video_grants(organization_id,brand_id,models,expires_at,budget_micros,max_create_micros,max_edit_micros,operator_reference,enabled) VALUES($1,$2,ARRAY['kling-video/v3.0/std/image-to-video'],now()+interval '1 hour',10000000,100000,100000,'LOCAL BROWSER TEST ONLY',true) ON CONFLICT(organization_id,brand_id) DO UPDATE SET enabled=true,expires_at=now()+interval '1 hour'",[org,brand]);
 await page.setViewportSize({width:1440,height:1000});await page.goto(`${base}/b/${brand}/canvas`);
 await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
 await page.getByText('Brand image references',{exact:true}).click();
 await page.getByText('Add product photos',{exact:true}).click();
 await page.getByLabel('Choose a product photo',{exact:true}).setInputFiles({name:'video-product.png',mimeType:'image/png',buffer:png});
 await page.getByRole('button',{name:'Upload file',exact:true}).click();
 const approval=page.getByRole('region',{name:'Approve reference: Uploaded product photo',exact:true});
 await expect(approval.getByLabel('Reference name',{exact:true})).toBeVisible({timeout:60000});
 await approval.getByLabel('Reference name',{exact:true}).fill('Video product reference');
 await approval.getByLabel('I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.',{exact:true}).check();
 await approval.getByRole('button',{name:'Approve image reference',exact:true}).click();
 const imageCalls=generated,before=videoSubmits;
 await page.getByRole('button',{name:'Use Video product reference for video',exact:true}).click();
 const request=page.getByRole('region',{name:'Creative conversation',exact:true});
 await request.getByLabel('Describe your creative',{exact:true}).fill('TEST animate my uploaded product');
 await request.getByLabel('Video length (seconds)',{exact:true}).fill('3');
 await request.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByLabel('Video prompt',{exact:true})).toBeVisible({timeout:60000});assert.equal(videoSubmits,before);assert.equal(generated,imageCalls);
 async function approvePrompt(){
  await page.getByLabel('Video prompt',{exact:true}).fill('TEST user edited video prompt for uploaded photo');
  await page.getByLabel('Scene 1 action',{exact:true}).fill('TEST revised storyline using product');
  await page.getByLabel('I approve this prompt and authorize video generation using the configured allowance.').check();
  await page.getByRole('button',{name:'Approve prompt and generate video',exact:true}).click();
 }
 await approvePrompt();await expect(page.getByRole('link',{name:'Download video',exact:true})).toBeVisible({timeout:150000});assert.equal(videoSubmits,before+1);
 const binding=(await admin.query("SELECT r.brand_reference_id,r.export_id,v.manifest,v.project_id FROM app.video_versions v JOIN app.video_references r ON r.job_id=v.job_id WHERE r.brand_reference_id IS NOT NULL AND r.brand_id=$1",[brand])).rows[0];
 assert.ok(binding.brand_reference_id);assert.equal(binding.export_id,null);assert.equal(binding.manifest.reference.kind,'upload');assert.equal(binding.manifest.reference.brand_reference_id,binding.brand_reference_id);assert.ok(binding.manifest.plan.skills.length>0);
 await page.getByLabel('Video feedback',{exact:true}).fill('Make the movement softer and keep the product visible');
 await page.getByRole('button',{name:'Draft a revised video from feedback',exact:true}).click();
 await expect(page.getByLabel('Video prompt',{exact:true})).toBeVisible({timeout:60000});assert.equal(videoSubmits,before+1);
 await approvePrompt();await expect.poll(()=>videoSubmits,{timeout:60000}).toBe(before+2);
 await expect.poll(async()=>Number((await admin.query('SELECT count(*) AS n FROM app.video_versions WHERE project_id=$1',[binding.project_id])).rows[0].n),{timeout:150000}).toBe(2);
 await expect(page.getByLabel(/^Saved video version/).locator('option')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Send video for review',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Send video for review',exact:true}).click();
 await expect(page.getByLabel('I reviewed this saved video and caption.')).toBeEnabled();await page.getByLabel('I reviewed this saved video and caption.').check();
 await page.getByRole('button',{name:'Approve final video',exact:true}).click();
 await expect.poll(async()=>(await admin.query('SELECT v.status FROM app.video_versions v JOIN app.video_projects p ON p.latest_version_id=v.id WHERE p.id=$1',[binding.project_id])).rows[0].status).toBe('approved');
 assert.equal(generated,imageCalls);const accessibility=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations;assert.deepEqual(accessibility.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[]);
 await page.screenshot({path:'work/browser/uploaded-product-video-approved.png',fullPage:true});
 const latestVideo=(await admin.query('SELECT v.id,v.poster_key,v.poster_sha256,r.channel FROM app.video_versions v JOIN app.video_projects p ON p.latest_version_id=v.id JOIN app.video_requests r ON r.job_id=v.job_id WHERE p.id=$1',[binding.project_id])).rows[0];
 const startDay=new Date().toISOString().slice(0,10);
 const created=await post(`/api/v1/businesses/${brand}/content-plans`,{title:'TEST video cover plan',objective:'Show saved video poster',starts_on:startDay,timezone:'UTC',slots:[{channel:latestVideo.channel,format:'video',brief:'TEST saved video cover',planned_at:startDay+'T23:00:00Z',video_version_id:latestVideo.id}]},randomUUID());assert.equal(created.status,201,JSON.stringify(created.body));
 await page.goto(`${base}/b/${brand}/content-plan?start=${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(startDay+'T23:00:00Z'))}&plan=${created.body.id}`);
 const cover=page.locator('.daily-post .post-cover');await expect(cover).toBeVisible();await expect.poll(()=>cover.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
 const posterPixels=await cover.evaluate(img=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);return canvas.toDataURL('image/png').split(',')[1];});
 assert.deepEqual(await sharp(Buffer.from(posterPixels,'base64')).ensureAlpha().raw().toBuffer(),await sharp(await store.read(latestVideo.poster_key)).ensureAlpha().raw().toBuffer());
 await page.goto(`${base}/b/${brand}/overview`);
 await expect(page.locator('.upcoming-post .post-cover').first()).toBeVisible();
 await page.screenshot({path:'work/browser/home-video-cover.png',fullPage:true});

});

test('Archive displays removed posts and restores a real draft across reloads',async()=>{
 const plans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
 const p=await plans.create(actor,brand,{title:'Archive browser campaign',objective:'Retain removed posts',starts_on:'2027-04-01',timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'Archive browser topic',planned_at:'2027-04-03T10:00:00Z'}]},randomUUID());
 let s=(await plans.list(actor,brand,{start:'2027-04-01T00:00:00Z',end:'2027-05-01T00:00:00Z',plan_id:p.id})).slots[0];
 await page.goto(`${base}/b/${brand}/content-plan?slot=${s.id}`);
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'Archive post',exact:true}).click();
 await expect(page.getByRole('button',{name:'Archive post',exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Archived Posts',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Archived posts',exact:true})).toBeVisible();
 const card=page.getByRole('listitem').filter({has:page.getByRole('heading',{name:'Archive browser topic',exact:true})});
 await expect(card).toBeVisible();await page.reload();await expect(card).toBeVisible();
 await page.screenshot({path:'work/browser/archive-desktop.png',fullPage:true});
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
 await card.getByRole('button',{name:'Restore draft',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Post restored as a draft'})).toBeVisible();await expect(card).toHaveCount(0);
 await page.reload();await expect(card).toHaveCount(0);
 const restored=(await plans.list(actor,brand,{start:'2027-04-01T00:00:00Z',end:'2027-05-01T00:00:00Z',plan_id:p.id})).slots[0];
 assert.equal(restored.id,s.id);assert.equal(restored.state,'content_needed');assert.equal(restored.approved_by,null);
 await page.goto(`${base}/b/${brand}/content-plan?slot=${s.id}`);await expect(page.getByRole('region',{name:'Post details'})).toBeVisible();
});

test('Calendar generates a missing image in place and retains the finished preview after reload',async()=>{
 const plans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
 const p=await plans.create(actor,brand,{title:'Calendar image handoff',objective:'Generate directly from a saved topic',starts_on:'2027-04-01',timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'TEST clear product story for calendar',planned_at:'2027-04-03T10:00:00Z'}]},randomUUID());
 await page.goto(`${base}/b/${brand}/content-plan?start=2027-04-03&plan=${p.id}`);
 const card=page.locator('.daily-post');
 await expect(card.getByRole('button',{name:'Generate 1 image',exact:true})).toBeEnabled();
 await expect(card.locator('.post-thumbnail')).toHaveCount(0);
 await page.screenshot({path:'work/browser/calendar-image-needed.png',fullPage:true});
 await card.getByRole('button',{name:'Generate 1 image',exact:true}).click();
 await expect(card.locator('.post-thumbnail svg')).toBeVisible({timeout:90000});
 await expect(card.getByText('Draft ready',{exact:true})).toBeVisible();
 await page.reload();await expect(card.locator('.post-thumbnail svg')).toBeVisible();
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.content_slot_generations g JOIN app.content_slots s ON s.id=g.slot_id WHERE s.plan_id=$1',[p.id])).rows[0].n,1);
 await page.screenshot({path:'work/browser/calendar-image-ready.png',fullPage:true});
 assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
});

test('Archive displays standalone Canvas images, retains history and restores through a reload',async()=>{
 const root=`/api/v1/businesses/${brand}`;
 const t=await post(`${root}/canvas/threads`,{title:'Archive browser fixture'},randomUUID());assert.equal(t.status,201);
 const j=await post(`${root}/canvas/threads/${t.body.id}/messages`,{prompt:'TEST FIXTURE: standalone soap image for archive',format:'static',channel:'instagram',size:'1024x1024'},randomUUID());assert.equal(j.status,201);
 let saved;
 await waitFor(async()=>{saved=(await admin.query('SELECT project_id,output_version_id FROM app.creative_requests WHERE job_id=$1',[j.body.id])).rows[0];return !!saved.output_version_id;});
 await page.goto(`${base}/b/${brand}/canvas?thread=${t.body.id}&project=${saved.project_id}`);
 await expect(page.getByRole('button',{name:'Archive creative',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Archive creative',exact:true}).click();
 await expect(page.getByRole('button',{name:'Restore creative',exact:true})).toBeVisible();
 await page.goto(`${base}/b/${brand}/archive`);
 await page.getByRole('button',{name:'Canvas creations',exact:true}).click();
 await expect(page.getByRole('button',{name:'View creative & history',exact:true})).toHaveCount(1);
 await page.reload();await page.getByRole('button',{name:'Canvas creations',exact:true}).click();
 await page.getByRole('button',{name:'View creative & history',exact:true}).click();
 await expect(page.getByLabel('Saved version',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Post caption',{exact:true})).toBeDisabled();
 await page.screenshot({path:'work/browser/canvas-image-archive.png',fullPage:true});
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await page.getByRole('button',{name:'Restore creative',exact:true}).click();
 await expect(page.getByRole('button',{name:'Archive creative',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close history',exact:true}).click();
 await expect(page.getByRole('heading',{name:'No archived Canvas creations',exact:true})).toBeVisible();
 await page.goto(`${base}/b/${brand}/canvas?thread=${t.body.id}&project=${saved.project_id}`);
 await expect(page.getByRole('button',{name:'Archive creative',exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT archived_at FROM app.creative_projects WHERE id=$1',[saved.project_id])).rows[0].archived_at,null);
});

test('Stock photo replaces a calendar design, preserves its caption and reloads as a draft (MOCK Pexels)',async()=>{
 const {StockMedia}=await import('../../dist/stock-media.js'),{StockProvider}=await import('../../dist/stock-provider.js');
 const stock=runtime.app.get(StockMedia),priorProvider=stock.provider;
 const stockPhoto={id:42,alt:'TEST stock garden',photographer:'Fixture Photographer',url:'https://www.pexels.com/photo/garden-42/',photographer_url:'https://www.pexels.com/@fixture',src:{medium:'https://images.pexels.com/photos/42/medium.png',large2x:'https://images.pexels.com/photos/42/large.png'}};
 stock.provider=new StockProvider('FIXTURE',async url=>url.startsWith('https://api.pexels.com/')?Response.json(url.includes('/search?')?{photos:[stockPhoto],total_results:1}:stockPhoto):new Response(png,{headers:{'content-type':'image/png'}}));
 try{
  const plans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
  const p=await plans.create(actor,brand,{title:'Stock replacement fixture',objective:'Replace a generated background',starts_on:'2027-05-01',timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'TEST clear product story',planned_at:'2027-05-03T10:00:00Z'}]},randomUUID());
  await page.goto(`${base}/b/${brand}/content-plan?start=2027-05-03&plan=${p.id}`);const card=page.locator('.daily-post');await card.getByRole('button',{name:'Generate 1 image',exact:true}).click();await expect(card.locator('.post-thumbnail svg')).toBeVisible({timeout:90000});
  const before=(await admin.query('SELECT id,creative_version_id,revision FROM app.content_slots WHERE plan_id=$1',[p.id])).rows[0];
  await page.goto(`${base}/b/${brand}/content-plan?slot=${before.id}`);
  const picker=page.locator('.stock-picker').filter({has:page.locator('summary',{hasText:'Replace photo with stock'})});
  await picker.locator('summary').click();await picker.getByLabel('Search photos',{exact:true}).fill('garden');await picker.getByRole('button',{name:'Search photos',exact:true}).click();
  await picker.getByRole('button',{name:'Choose TEST stock garden by Fixture Photographer',exact:true}).click();await expect(picker.getByRole('button',{name:'Replace photo & save draft',exact:true})).toBeVisible({timeout:60000});
  await picker.getByRole('checkbox').check();await picker.getByRole('button',{name:'Replace photo & save draft',exact:true}).click();await expect(page.getByText('Photo replaced. This post is a draft ready for review.',{exact:true})).toBeVisible();
  const after=(await admin.query('SELECT creative_version_id,state,approved_by FROM app.content_slots WHERE id=$1',[before.id])).rows[0];assert.notEqual(after.creative_version_id,before.creative_version_id);assert.equal(after.state,'draft_ready');assert.equal(after.approved_by,null);
  const versions=(await admin.query('SELECT id,caption,media_id,parent_id FROM app.creative_versions WHERE id=ANY($1::uuid[])',[[before.creative_version_id,after.creative_version_id]])).rows;assert.equal(versions[0].caption,versions[1].caption);
  await page.reload();await expect(page.getByRole('heading',{name:'Saved caption',exact:true})).toBeVisible();await page.screenshot({path:'work/browser/stock-calendar-replacement.png',fullPage:true});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 }finally{stock.provider=priorProvider;}
});

test('Archive displays generated carousels with saved slide history and restores without scheduling (MOCK providers)',async()=>{
 // Real authenticated routes, Postgres, object storage and rasterization; only AI transports are doubled.
 await page.setViewportSize({width:1440,height:1000});await page.goto(`${base}/b/${brand}/canvas`);
 const composer=page.getByRole('region',{name:'Creative conversation',exact:true});await composer.getByLabel('Describe your creative',{exact:true}).fill('TEST create a carousel for archive history');await composer.getByLabel('Slides',{exact:true}).fill('2');await composer.getByRole('button',{name:'Send',exact:true}).click();
 const panel=page.getByRole('region',{name:'Carousels',exact:true});await expect(panel.getByRole('button',{name:'Review generated carousel',exact:true})).toBeVisible({timeout:90000});await panel.getByRole('button',{name:'Review generated carousel',exact:true}).click();
 const review=panel.getByRole('region',{name:'Review carousel',exact:true});await expect(review.getByRole('img')).toHaveCount(2);
 const project=(await admin.query('SELECT id,latest_version_id FROM app.carousel_projects WHERE brand_id=$1 ORDER BY created_at DESC LIMIT 1',[brand])).rows[0];
 const original=(await admin.query('SELECT * FROM app.carousel_versions WHERE id=$1',[project.latest_version_id])).rows[0];const pages=(await admin.query('SELECT creative_version_id,export_id,alt_text FROM app.carousel_pages WHERE carousel_version_id=$1 ORDER BY position',[original.id])).rows;
 const edit=await post(`/api/v1/businesses/${brand}/carousels`,{project_id:project.id,parent_id:original.id,title:original.title,caption:'TEST revised archive carousel caption',channel:original.channel,pages:[...pages].reverse()},randomUUID());assert.equal(edit.status,201,JSON.stringify(edit.body));
 await page.reload();await panel.getByText('Carousels · compose and review slides',{exact:true}).click();await panel.getByRole('button',{name:'Review generated carousel',exact:true}).click();
 const before=(await admin.query('SELECT id,sha256,status FROM app.carousel_versions WHERE project_id=$1 ORDER BY id',[project.id])).rows;
 const publications=Number((await admin.query('SELECT count(*) AS n FROM app.publication_requests WHERE brand_id=$1',[brand])).rows[0].n);
 await panel.getByRole('button',{name:'Archive carousel',exact:true}).click();
 await page.goto(`${base}/b/${brand}/archive`);await page.getByRole('button',{name:'Canvas creations',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Canvas creations',exact:true}).click();await page.getByRole('button',{name:'View creative & history',exact:true}).click();
 const history=page.getByRole('region',{name:'Archived media history',exact:true});await expect(history.getByLabel('Saved media version',{exact:true}).locator('option')).toHaveCount(2);await expect(history.getByRole('img')).toHaveCount(2);
 await expect.poll(()=>history.getByRole('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
 await history.getByLabel('Saved media version',{exact:true}).selectOption(original.id);await expect(history.getByRole('img')).toHaveCount(2);await expect(history.getByRole('button',{name:'Approve carousel',exact:true})).toHaveCount(0);
 await page.screenshot({path:'work/browser/canvas-carousel-archive.png',fullPage:true});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await history.getByRole('button',{name:'Restore carousel',exact:true}).click();await expect(page.getByRole('heading',{name:'No archived Canvas creations',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Canvas creations',exact:true}).click();await expect(page.getByRole('heading',{name:'No archived Canvas creations',exact:true})).toBeVisible();
 assert.deepEqual((await admin.query('SELECT id,sha256,status FROM app.carousel_versions WHERE project_id=$1 ORDER BY id',[project.id])).rows,before);assert.equal((await admin.query('SELECT archived_at FROM app.carousel_projects WHERE id=$1',[project.id])).rows[0].archived_at,null);
 assert.equal(Number((await admin.query('SELECT count(*) AS n FROM app.content_slots WHERE carousel_version_id=ANY($1::uuid[])',[before.map(v=>v.id)])).rows[0].n),0);assert.equal(Number((await admin.query('SELECT count(*) AS n FROM app.publication_requests WHERE brand_id=$1',[brand])).rows[0].n),publications);
});

test('Archive displays generated video history, plays saved media and restores across reloads (MOCK providers)',async()=>{
 // Auth, storage, worker, approvals and video rendering are real; provider response uses the fixture MP4.
 await admin.query("INSERT INTO app.video_grants(organization_id,brand_id,models,expires_at,budget_micros,max_create_micros,max_edit_micros,operator_reference,enabled) VALUES($1,$2,ARRAY['kling-video/v3.0/std/image-to-video'],now()+interval '1 hour',10000000,100000,100000,'LOCAL BROWSER TEST ONLY',true) ON CONFLICT(organization_id,brand_id) DO UPDATE SET enabled=true,expires_at=now()+interval '1 hour'",[org,brand]);
 await page.setViewportSize({width:1440,height:1000});await page.goto(`${base}/b/${brand}/canvas`);await page.getByRole('button',{name:'+ New conversation',exact:true}).click();await page.getByRole('button',{name:'Add assets',exact:true}).click();await page.getByText('Brand image references',{exact:true}).click();await page.getByText('Add product photos',{exact:true}).click();await page.getByLabel('Choose a product photo',{exact:true}).setInputFiles({name:'archive-video.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Upload file',exact:true}).click();
 const approval=page.getByRole('region',{name:'Approve reference: Uploaded product photo',exact:true});await expect(approval.getByLabel('Reference name',{exact:true})).toBeVisible({timeout:60000});await approval.getByLabel('Reference name',{exact:true}).fill('Archive video reference');await approval.getByLabel('I have permission to use this image and allow it to be sent to the AI provider for my business’s creatives.',{exact:true}).check();await approval.getByRole('button',{name:'Approve image reference',exact:true}).click();await page.getByRole('button',{name:'Use Archive video reference for video',exact:true}).click();
 const request=page.getByRole('region',{name:'Creative conversation',exact:true});await request.getByLabel('Describe your creative',{exact:true}).fill('TEST archive video history');await request.getByLabel('Video length (seconds)',{exact:true}).fill('3');await request.getByRole('button',{name:'Send',exact:true}).click();
 async function approveArchivePrompt(){await expect(page.getByLabel('Video prompt',{exact:true})).toBeVisible({timeout:60000});await page.getByLabel('Video prompt',{exact:true}).fill('TEST user edited video prompt for archive');await page.getByLabel('Scene 1 action',{exact:true}).fill('TEST revised storyline for archive');await page.getByLabel('I approve this prompt and authorize video generation using the configured allowance.').check();await page.getByRole('button',{name:'Approve prompt and generate video',exact:true}).click();}
 await approveArchivePrompt();await expect(page.getByRole('link',{name:'Download video',exact:true})).toBeVisible({timeout:150000});const project=(await admin.query('SELECT id FROM app.video_projects WHERE brand_id=$1 ORDER BY created_at DESC LIMIT 1',[brand])).rows[0];
 await page.getByLabel('Video feedback',{exact:true}).fill('TEST softer movement for archive revision');await page.getByRole('button',{name:'Draft a revised video from feedback',exact:true}).click();await approveArchivePrompt();await expect.poll(async()=>Number((await admin.query('SELECT count(*) AS n FROM app.video_versions WHERE project_id=$1',[project.id])).rows[0].n),{timeout:150000}).toBe(2);await expect(page.getByLabel(/^Saved video version/).locator('option')).toHaveCount(2);
 const before=(await admin.query('SELECT id,sha256,status FROM app.video_versions WHERE project_id=$1 ORDER BY created_at,id',[project.id])).rows;const publications=Number((await admin.query('SELECT count(*) AS n FROM app.publication_requests WHERE brand_id=$1',[brand])).rows[0].n);
 await page.getByRole('button',{name:'Archive video',exact:true}).click();await page.goto(`${base}/b/${brand}/archive`);await page.getByRole('button',{name:'Canvas creations',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Canvas creations',exact:true}).click();await page.getByRole('button',{name:'View creative & history',exact:true}).click();
 const history=page.getByRole('region',{name:'Archived media history',exact:true});await expect(history.getByLabel('Saved media version',{exact:true}).locator('option')).toHaveCount(2);
 const failedDownload=`**/video-versions/${before[0].id}/download`;await page.route(failedDownload,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'TEST transient video download failure'})}));
 await history.getByLabel('Saved media version',{exact:true}).selectOption(before[0].id);await expect(history.getByRole('button',{name:'Reload video preview',exact:true})).toBeVisible();await expect(history.getByText('Video preview unavailable',{exact:true})).toBeVisible();await expect(history.locator('video')).toHaveCount(0);
 await page.unroute(failedDownload);await history.getByRole('button',{name:'Reload video preview',exact:true}).click();
 const video=history.locator('video');await expect(video).toBeVisible();await expect.poll(()=>video.evaluate(v=>v.readyState>=2&&v.videoWidth>0),{timeout:60000}).toBe(true);await video.evaluate(async v=>{v.muted=true;await v.play();});await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:10000}).toBeGreaterThan(0);await video.evaluate(v=>v.pause());await expect(history.getByRole('button',{name:'Approve final video',exact:true})).toHaveCount(0);
 await page.screenshot({path:'work/browser/canvas-video-archive.png',fullPage:true});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
 await history.getByRole('button',{name:'Restore video',exact:true}).click();await expect(page.getByRole('heading',{name:'No archived Canvas creations',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Canvas creations',exact:true}).click();await expect(page.getByRole('heading',{name:'No archived Canvas creations',exact:true})).toBeVisible();
 assert.deepEqual((await admin.query('SELECT id,sha256,status FROM app.video_versions WHERE project_id=$1 ORDER BY created_at,id',[project.id])).rows,before);assert.equal((await admin.query('SELECT archived_at FROM app.video_projects WHERE id=$1',[project.id])).rows[0].archived_at,null);assert.equal(Number((await admin.query('SELECT count(*) AS n FROM app.content_slots WHERE video_version_id=ANY($1::uuid[])',[before.map(v=>v.id)])).rows[0].n),0);assert.equal(Number((await admin.query('SELECT count(*) AS n FROM app.publication_requests WHERE brand_id=$1',[brand])).rows[0].n),publications);
});

test('Generation notification opt-in survives reload and cancels without sending external mail',async()=>{
 const root=`/api/v1/businesses/${brand}`;
 const t=await post(`${root}/canvas/threads`,{title:'Notification browser fixture'},randomUUID());assert.equal(t.status,201);
 const j=await post(`${root}/canvas/threads/${t.body.id}/messages`,{prompt:'TEST FIXTURE: soap image for notification',format:'static',channel:'instagram',size:'1024x1024'},randomUUID());assert.equal(j.status,201);
 await waitFor(async()=>!!(await admin.query('SELECT output_version_id FROM app.creative_requests WHERE job_id=$1',[j.body.id])).rows[0]?.output_version_id);
 await page.goto(`${base}/b/${brand}/canvas?thread=${t.body.id}`);
 await page.getByRole('button',{name:'Email me a link when ready',exact:true}).click();
 await expect(page.getByRole('button',{name:'Cancel email',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'Cancel email',exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.generation_notifications WHERE actor_id=$1 AND job_ids=$2::uuid[]',[actor,[j.body.id]])).rows[0].n,1);
 await page.getByRole('button',{name:'Cancel email',exact:true}).click();
 await expect(page.getByText('Email canceled for this generation. Your saved work remains available.',{exact:true})).toBeVisible();
 assert.equal((await admin.query('SELECT o.status FROM delivery.outbox o JOIN app.generation_notifications n ON n.mail_id=o.id WHERE n.actor_id=$1 AND n.job_ids=$2::uuid[]',[actor,[j.body.id]])).rows[0].status,'canceled');
 await page.screenshot({path:'work/browser/generation-notification.png',fullPage:true});
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
});

test('Strategy launch groups a real campaign and dispatches capped images from Home (MOCK AI)',async()=>{
 // Explicit validated stock-independent brand-photo fixture; upload/scanner path has separate coverage.
 const assetId=randomUUID(),visualId=randomUUID(),captureId=randomUUID(),jpg=await sharp({create:{width:640,height:480,channels:3,background:'#a6b98a'}}).jpeg().toBuffer(),sha=digest(jpg),objectKey=`evidence/${org}/${brand}/strategy-reference/${sha}`;
 await store.persist(objectKey,jpg,'image/jpeg',sha);
 await admin.query("INSERT INTO app.assets(id,organization_id,brand_id,created_by,filename,content_type,expected_bytes,sha256,quarantine_key,canonical_key,state) VALUES($1,$2,$3,$4,'STRATEGY FIXTURE.jpg','image/jpeg',$5,$6,$7,$8,'ready')",[assetId,org,brand,actor,jpg.length,sha,objectKey+'-quarantine',objectKey]);
 await admin.query("INSERT INTO app.jobs(id,organization_id,brand_id,asset_id,requested_by,kind,status) VALUES($1,$2,$3,$4,$5,'asset.validate','succeeded')",[captureId,org,brand,assetId,actor]);
 await admin.query('INSERT INTO app.uploaded_visuals(id,organization_id,brand_id,asset_id,job_id,object_key,sha256,source_sha256,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,640,480)',[visualId,org,brand,assetId,captureId,objectKey,sha,jpg.length]);
 assert.equal((await post(`/api/v1/businesses/${brand}/canvas/references`,{kind:'upload',visual_id:visualId,label:'TEST strategy image',consent:true},randomUUID())).status,201);

 const businesses=new Businesses(runtime.database,new Workspaces(runtime.database)),preferences=await businesses.onboarding(actor,brand);
 if(preferences.step!==3)await businesses.onboarding(actor,brand,{revision:preferences.revision,step:3,goal:'awareness',timezone:'UTC',cadence:3,channels:['linkedin','instagram'],must_avoid:'No unsupported claims',preferences_edited:true});
 await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,provider,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,'openai',true,'MOCK-plan',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL BROWSER TEST ONLY') ON CONFLICT(organization_id,brand_id,provider) DO UPDATE SET enabled=true,budget_micros=10000000",[org,brand]);
 await page.goto(`${base}/b/${brand}/overview`);await page.getByRole('button',{name:'＋ Create new',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('link',{name:/Add strategy/}).click();
 await expect(page.getByRole('heading',{name:'Your strategies',exact:true})).toBeVisible();await expect(page.locator('.strategy-banner img').first()).toBeVisible();await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Product education',exact:true})}).getByRole('button',{name:'Set up strategy'}).click();
 await page.getByLabel('Strategy name',{exact:true}).fill('TEST visual strategy');await page.getByLabel('Start date',{exact:true}).fill('2027-01-04');
 await expect.poll(async()=>Number(await page.getByLabel('Credit cap per image',{exact:true}).inputValue())).toBeGreaterThan(0);const strategyPlanning=Number(await page.getByLabel('Planning credit cap',{exact:true}).inputValue()),strategyImage=Number(await page.getByLabel('Credit cap per image',{exact:true}).inputValue()),strategyCap=Number(await page.getByLabel('Strategy credit cap',{exact:true}).inputValue());
 const strategyRoute=`**/api/v1/businesses/${brand}/strategies`;let rejectedKey,uncertainKey,retryKey;
 await page.route(strategyRoute,async route=>{if(route.request().method()!=='POST')return route.continue();rejectedKey=route.request().headers()['idempotency-key'];await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Planning limit reached'})});});
 await page.getByRole('button',{name:'Launch strategy',exact:true}).click();await expect(page.getByLabel('Strategy name',{exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();await page.unroute(strategyRoute);
 await page.route(strategyRoute,async route=>{if(route.request().method()!=='POST')return route.continue();uncertainKey=route.request().headers()['idempotency-key'];await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary unavailable'})});});
 await page.getByRole('button',{name:'Launch strategy',exact:true}).click();await expect(page.getByRole('button',{name:'Check saved launch',exact:true})).toBeEnabled();await expect(page.getByLabel('Strategy name',{exact:true})).toBeDisabled();await page.unroute(strategyRoute);
 await page.route(strategyRoute,async route=>{if(route.request().method()==='POST')retryKey=route.request().headers()['idempotency-key'];await route.continue();});await page.getByRole('button',{name:'Check saved launch',exact:true}).click();await page.unroute(strategyRoute);assert.equal(retryKey,uncertainKey);assert.notEqual(rejectedKey,uncertainKey);
 const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'TEST visual strategy',exact:true})});await expect(card.getByRole('link',{name:'Review campaign',exact:true})).toBeVisible({timeout:60000});
 await card.getByRole('button',{name:'Create campaign images',exact:true}).click();await expect(card.getByText(`${strategyPlanning+3*strategyImage} / ${strategyCap} credits allocated · Manual`,{exact:true})).toBeVisible();
 await expect(card.locator('.post-thumbnail svg image')).toBeVisible({timeout:90000});
 const strategy=(await admin.query('SELECT id FROM app.content_strategies WHERE brand_id=$1 AND name=$2',[brand,'TEST visual strategy'])).rows[0];assert.ok(strategy);assert.equal((await admin.query('SELECT count(*)::int AS n FROM app.strategy_image_requests WHERE strategy_id=$1',[strategy.id])).rows[0].n,3);
 await admin.query("UPDATE app.jobs SET status='rejected',error_code='EXPORT_RENDER_FAILED' WHERE id=(SELECT job_id FROM app.strategy_image_requests WHERE strategy_id=$1 LIMIT 1)",[strategy.id]);await page.reload();await expect(card.getByText('Images need attention',{exact:true})).toBeVisible();await expect(card.getByText(/Open the campaign to review the issue/)).toBeVisible();await expect(card.getByRole('button',{name:'Create campaign images',exact:true})).toHaveCount(0);await expect(card.getByRole('link',{name:'Review campaign',exact:true})).toBeVisible();await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Lifestyle content',exact:true})}).getByRole('button',{name:'Set up strategy'}).click();
 await page.getByLabel('Strategy name',{exact:true}).fill('TEST scheduled strategy');await page.getByLabel('Campaign schedule',{exact:true}).selectOption('4');await expect.poll(async()=>Number(await page.getByLabel('Planning credit cap',{exact:true}).inputValue())).toBe(strategyPlanning*4);const weeklyCap=Number(await page.getByLabel('Strategy credit cap',{exact:true}).inputValue());await page.getByLabel('I authorize 4 weekly campaign plans',{exact:false}).check();await page.getByRole('button',{name:'Launch strategy',exact:true}).click();
 const recurring=page.getByRole('article').filter({has:page.getByRole('heading',{name:'TEST scheduled strategy',exact:true})});await expect(recurring.getByRole('listitem')).toHaveCount(4);await recurring.getByRole('button',{name:'Stop future campaigns',exact:true}).click();await expect(recurring.getByText(`${strategyPlanning*4} / ${weeklyCap} credits allocated · Stopped`,{exact:true})).toBeVisible();
 await page.reload();await expect(recurring.getByText(`${strategyPlanning*4} / ${weeklyCap} credits allocated · Stopped`,{exact:true})).toBeVisible();await page.locator('.strategy-banner').last().scrollIntoViewIfNeeded();await expect(page.locator('.strategy-banner img')).toHaveCount(4);await page.getByRole('heading',{name:'Your strategies',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'work/browser/strategies-desktop.png',fullPage:true});
 const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(scan.violations,[]);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:'work/browser/strategies-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:900});
});

test('Reviewed campaign continues once into durable image generation and visual progress',async()=>{
 await admin.query('UPDATE app.creative_grants SET max_image_request_micros=5000000,budget_micros=100000000 WHERE brand_id=$1',[brand]);
 const plans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
 const p=await plans.create(actor,brand,{title:'Reviewed campaign',objective:'Create finished posts after topic review',starts_on:'2027-06-01',timezone:'UTC',slots:[0,1].map(i=>({channel:'instagram',format:'static',brief:`TEST reviewed product story ${i}`,planned_at:`2027-06-0${i+1}T10:00:00Z`}))},randomUUID());
 // Observe the automatic request before opening the campaign; interrupt only its response.
 let requests=0,submitted;
 await page.route(`**/content-plans/${p.id}/generate-images`,async route=>{requests++;submitted=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Response interrupted'})});});
 await page.goto(`${base}/b/${brand}/campaign-review?plan=${p.id}`);
 await expect(page.getByRole('button',{name:'Check image request',exact:true})).toBeEnabled();await page.reload();
 await expect(page.getByRole('heading',{name:'Your content is ready',exact:true})).toBeVisible({timeout:90000});
 const covers=page.locator('.campaign-preview-grid .post-thumbnail :is(svg image,img.post-cover)');await expect(covers).toHaveCount(2);
 await expect.poll(()=>covers.evaluateAll(images=>Promise.all(images.map(i=>new Promise(resolve=>{const probe=new Image();probe.onload=()=>resolve(probe.naturalWidth>0);probe.onerror=()=>resolve(false);probe.src=i.localName==='image'?i.href.baseVal:i.src;}))).then(values=>values.every(Boolean)))).toBe(true);
 assert.equal(requests,1);assert.equal(submitted.automatic,true);assert.ok(submitted.credit_cap>0);
 const batches=(await admin.query('SELECT reviewed_slots,credit_cap,job_ids FROM app.campaign_image_batches WHERE plan_id=$1',[p.id])).rows;assert.equal(batches.length,1);assert.equal(batches[0].credit_cap,submitted.credit_cap);assert.equal(batches[0].reviewed_slots.length,2);assert.equal(batches[0].job_ids.length,2);
 await page.unrouteAll({behavior:'wait'});await page.reload();await expect(covers).toHaveCount(2);await expect(page.getByRole('button',{name:/Continue · create/})).toHaveCount(0);
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);await page.screenshot({path:'work/browser/reviewed-campaign-ready.png',fullPage:true});
 const next=await plans.create(actor,brand,{title:'Single continued campaign',objective:'One action to finished content',starts_on:'2027-06-04',timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'TEST normal continuation',planned_at:'2027-06-04T10:00:00Z'}]},randomUUID());await page.goto(`${base}/b/${brand}/campaign-review?plan=${next.id}`);await expect.poll(()=>new URL(page.url()).searchParams.get('stage')).toBe('generating');await expect(page.locator('.campaign-preview-grid .post-thumbnail :is(svg image,img.post-cover)')).toHaveCount(1,{timeout:90000});await expect(page.getByRole('button',{name:/Continue · create/})).toHaveCount(0);
 const mixed=await plans.create(actor,brand,{title:'Visual format campaign',objective:'Images and slides together',starts_on:'2027-06-06',timezone:'UTC',slots:[{channel:'instagram',format:'carousel',creative_spec:{placement:'feed',aspect:'portrait',slide_count:2},brief:'TEST coordinated soap story',planned_at:'2027-06-06T10:00:00Z'},{channel:'instagram',format:'static',creative_spec:{placement:'story',aspect:'vertical',slide_count:null},brief:'TEST vertical soap story',planned_at:'2027-06-07T10:00:00Z'}]},randomUUID());
 await page.goto(`${base}/b/${brand}/campaign-review?plan=${mixed.id}`);await expect(page.getByRole('heading',{name:'Your content is ready',exact:true})).toBeVisible({timeout:180000});
 await page.getByRole('button',{name:'Preview slides',exact:true}).click();await expect(page.getByRole('button',{name:'Next slide',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Next slide',exact:true}).click();await expect(page.getByText('2 of 2',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Next slide',exact:true})).toBeDisabled();await expect(page.getByRole('dialog',{name:'Carousel preview'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Carousel preview'})).not.toBeVisible();await expect(page.getByRole('button',{name:'Preview slides',exact:true})).toBeFocused();await page.evaluate(()=>window.scrollTo(0,0));
 const storyCard=page.getByRole('listitem').filter({has:page.locator('.campaign-card-top').getByText('Image story',{exact:true})});await expect(storyCard.locator('.post-thumbnail svg')).toHaveAttribute('viewBox','0 0 1080 1920');await page.screenshot({path:'work/browser/reviewed-mixed-formats.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'work/browser/reviewed-mixed-viewport.png'});await page.evaluate(()=>scrollTo(0,300));await page.screenshot({path:'work/browser/reviewed-mixed-scrolled.png'});await page.evaluate(()=>scrollTo(0,0));
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'Preview slides',exact:true}).click();await expect(page.getByRole('dialog',{name:'Carousel preview'})).toBeVisible();assert.ok((await page.getByRole('dialog',{name:'Carousel preview'}).boundingBox()).width<=390);await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));
 const videosBefore=(await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.video'",[brand])).rows[0].n;
 const videos=await plans.create(actor,brand,{title:'Video approval campaign',objective:'Review before generation',starts_on:'2027-06-10',timezone:'UTC',slots:['reel','story'].map((placement,i)=>({channel:'instagram',format:'video',creative_spec:{placement,aspect:'vertical',slide_count:null},brief:'TEST approval required',planned_at:`2027-06-${10+i}T10:00:00Z`}))},randomUUID());
 await page.goto(`${base}/b/${brand}/campaign-review?plan=${videos.id}`);await expect(page.getByText('Open each video post to review its script and reference image before generation.',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Open each video post to review its script and reference image before generation.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Review script and framing',exact:true})).toHaveCount(2);await expect(page.locator('.campaign-card-top').getByText('Reel',{exact:true})).toBeVisible();await expect(page.locator('.campaign-card-top').getByText('Video story',{exact:true})).toBeVisible();
 assert.equal((await admin.query("SELECT count(*)::int AS n FROM app.jobs WHERE brand_id=$1 AND kind='creative.video'",[brand])).rows[0].n,videosBefore);await expect(page.getByRole('button',{name:/Continue · create/})).toHaveCount(0);await page.screenshot({path:'work/browser/reviewed-video-approval.png',fullPage:true});
});

test('Generated replacement confirms credits, survives reload and preserves scheduled approval until explicit attachment (MOCK Higgsfield)',async()=>{
 await admin.query("INSERT INTO app.higgsfield_image_grants(organization_id,brand_id,enabled,budget_micros,max_request_micros,expires_at,approved_by) VALUES($1,$2,true,100000,10000,now()+interval '1 hour','TEST')",[org,brand]);
 const plans=new ContentPlan(new Businesses(runtime.database,new Workspaces(runtime.database)));
 const p=await plans.create(actor,brand,{title:'Generated replacement fixture',objective:'An editable visual draft',starts_on:'2027-05-01',timezone:'UTC',slots:[{channel:'instagram',format:'static',brief:'TEST clear product story',planned_at:'2027-05-03T10:00:00Z'}]},randomUUID());
 await page.goto(`${base}/b/${brand}/content-plan?start=2027-05-03&plan=${p.id}`);const card=page.locator('.daily-post');await card.getByRole('button',{name:'Generate 1 image',exact:true}).click();await expect(card.locator('.post-thumbnail svg')).toBeVisible({timeout:90000});
 const before=(await admin.query('SELECT id,creative_version_id FROM app.content_slots WHERE plan_id=$1',[p.id])).rows[0];
 // A previously approved scheduled post is the fixture under test; generation must not mutate it.
 await admin.query("UPDATE app.content_slots SET state='approved',approved_by=$2,approved_at=now() WHERE id=$1",[before.id,actor]);
 await page.goto(`${base}/b/${brand}/content-plan?slot=${before.id}`);
 const picker=page.locator('.stock-picker').filter({has:page.locator('summary',{hasText:'Generate replacement'})});
 await expect(page.locator('summary').filter({hasText:'Replace photo with stock'})).toHaveCount(0);await expect(page.getByLabel('Search photos',{exact:true})).toHaveCount(0);
 await picker.locator('summary').click();await picker.getByLabel('Describe the photo',{exact:true}).fill('TEST airy workspace in soft blue daylight');await expect(picker.getByRole('button',{name:'Generate · 1 credit',exact:true})).toBeEnabled();assert.equal(replacementSubmits,0);
 await picker.getByRole('button',{name:'Generate · 1 credit',exact:true}).click();await expect(picker.getByText('Creating your replacement photo…',{exact:true})).toBeVisible();await page.reload();await picker.locator('summary').click();await expect(picker.getByText('Creating your replacement photo…',{exact:true})).toBeVisible();
 replacementReady=true;await expect(page.getByRole('button',{name:'Attach latest Canvas version',exact:true})).toBeVisible({timeout:90000});assert.equal(replacementSubmits,1);
 const unchanged=(await admin.query('SELECT creative_version_id,state,approved_by FROM app.content_slots WHERE id=$1',[before.id])).rows[0];assert.equal(unchanged.creative_version_id,before.creative_version_id);assert.equal(unchanged.state,'approved');assert.equal(unchanged.approved_by,actor);
 await expect(page.getByRole('button',{name:'Attach latest Canvas version',exact:true})).toBeDisabled();await page.getByRole('checkbox',{name:/I understand that changing this post/}).check();await page.getByRole('button',{name:'Attach latest Canvas version',exact:true}).click();
 await expect(page.getByText('Latest Canvas version attached as an unapproved draft.',{exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Saved caption',exact:true})).toBeVisible();
 const after=(await admin.query('SELECT creative_version_id,state,approved_by FROM app.content_slots WHERE id=$1',[before.id])).rows[0];assert.notEqual(after.creative_version_id,before.creative_version_id);assert.equal(after.state,'draft_ready');assert.equal(after.approved_by,null);assert.equal(replacementSubmits,1);
 await expect.poll(()=>page.locator('.creative-artboard canvas.lower-canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(10,10,1,1).data).slice(0,3))).toEqual([179,217,232]);
 await page.screenshot({path:'work/browser/generated-calendar-replacement.png',fullPage:true});assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
});


test('AI canvas interprets, generates inline, resumes a lost response and remembers history (MOCK OpenAI)',async()=>{
 await admin.query("INSERT INTO app.planning_grants(organization_id,brand_id,enabled,model,expires_at,budget_micros,input_micros_per_token,output_micros_per_token,approved_by) VALUES($1,$2,true,'MOCK-plan',now()+interval '1 hour',10000000,0.01,0.02,'LOCAL TEST ONLY')",[org,brand]);
 await page.goto(`${base}/b/${brand}/create`);
 await page.getByRole('textbox',{name:'Message Desvio'}).fill('Create a clean botanical soap image for mindful households without text');
 // Server commits the message but the response is lost. Reload must resume the same envelope.
 let dropped=false;
 await page.route('**/create-chat/messages',async route=>{if(dropped){await route.continue();return;}dropped=true;await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saved request'})).toBeVisible();
 await page.reload();
 await expect(page).toHaveURL(/conversation=/,{timeout:20000});
 await expect(page.getByRole('heading',{name:'Your creative',exact:true})).toBeVisible({timeout:90000});
 assert.equal(chatCalls,1);assert.equal(generated,1);
 await page.screenshot({path:'work/browser/chat-canvas-desktop.png',fullPage:true});
 const conversation=new URL(page.url()).searchParams.get('conversation');
 const progressResponse=await page.request.get(`${base}/api/v1/businesses/${brand}/canvas/threads/${conversation}`);
 assert.equal(progressResponse.status(),200,'Customer role can read workflow progress without provider-call access');
 const progressRun=(await progressResponse.json()).runs[0];
 assert.equal(progressRun.selected_text_model,'gpt-6-sol');assert.equal(progressRun.brief_ready,true);assert.equal(progressRun.image_received,true);assert.ok(progressRun.output_version_id);
 await expect(page.getByRole('progressbar',{name:'Completed image workflow steps',exact:true})).toHaveAttribute('value','5',{timeout:30000});
 await expect(page.getByText('Conversation saved · Available in History',{exact:true})).toBeVisible();
 // A manual saved version has no generation-job foreign key; conversational edit must use it.
 const project=(await admin.query('SELECT id,latest_version_id FROM app.creative_projects WHERE thread_id=$1',[conversation])).rows[0];
 const old=(await admin.query('SELECT design,caption FROM app.creative_versions WHERE id=$1',[project.latest_version_id])).rows[0];
 old.design.layers=[{id:'custom',type:'text',text:'Keep my manually added headline',x:72,y:72,width:880,fontSize:48,fontFamily:'Lora',fontWeight:600,fill:'#ffffff',backing:{fill:'#111111',opacity:0.96,padding:16},align:'left'}];
 const manual=await post(`/api/v1/businesses/${brand}/creative-projects/${project.id}/versions`,{parent_id:project.latest_version_id,design:old.design,caption:'TEST manually edited caption'},randomUUID());
 assert.equal(manual.status,201,JSON.stringify(manual.body));
 await page.getByRole('textbox',{name:'Message Desvio'}).fill('Make it warmer');
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(()=>generated,{timeout:90000}).toBe(2);
 const edited=(await admin.query('SELECT parent_version_id FROM app.creative_requests WHERE thread_id=$1 ORDER BY job_id',[conversation])).rows;
 assert.ok(edited.some(r=>r.parent_version_id===manual.body.id));
 await expect.poll(async()=> (await admin.query('SELECT latest_version_id FROM app.creative_projects WHERE id=$1',[project.id])).rows[0].latest_version_id,{timeout:90000}).not.toBe(manual.body.id);
 const revised=(await admin.query('SELECT v.design FROM app.creative_projects p JOIN app.creative_versions v ON v.id=p.latest_version_id WHERE p.id=$1',[project.id])).rows[0].design;
 assert.equal(revised.layers.find(layer=>layer.id==='custom').text,'Keep my manually added headline');
 assert.equal(revised.layers[0].fontFamily,'Lora');
 await page.getByRole('button',{name:'New chat',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Desvio'}).fill('Remember the soap image we created?');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText('I found your saved conversation.',{exact:true})).toBeVisible({timeout:60000});assert.equal(generated,2);
 await page.locator('.conversation-sources button').click();await expect(page).toHaveURL(new RegExp(conversation));
 await page.getByRole('button',{name:'History',exact:true}).click();await expect(page.getByRole('dialog',{name:'Conversation history'})).toBeVisible();await page.getByLabel('Search this business’s conversations').fill('botanical');await expect(page.getByRole('dialog').locator('li')).toHaveCount(1);
 await page.getByRole('button',{name:'Close history',exact:true}).click();
 for(const viewport of [{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await page.screenshot({path:`work/browser/chat-canvas-${viewport.width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await page.setViewportSize({width:1440,height:1000});
 assert.deepEqual(errors,[]);
});
