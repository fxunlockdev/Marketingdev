import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  publicAddress,
  websiteURL,
  SafeWeb,
  WebsiteReader,
} from "../../dist/safe-web.js";
import {
  BrandAnalyzer,
  validateAnalysis,
  analysisRequest,
} from "../../dist/brand-analysis.js";
import { prepareVisuals } from "../../dist/visual-analysis.js";
import { digest } from "../../dist/object-store.js";
import sharp from "sharp";
const chunk = {
  id: "chunk-1",
  source_id: "source-1",
  text: "Acme makes scheduling tools for dental practices.",
  page: 1,
  website_url: "https://example.org/",
};
const input = { chunks: [chunk], reviewed: [] };
const result = {
  findings: [
    {
      field: "offering",
      value: "Scheduling tools",
      chunk_id: chunk.id,
      quote: "scheduling tools",
    },
  ],
  recommendation: {
    goal: "leads",
    audience: "Dental practices",
    channels: ["linkedin"],
    cadence: 3,
    reason: "The source describes a product for dental practices.",
    chunk_ids: [chunk.id],
  },
  missing: ["Brand voice"],
};
test("vision uses verified pixels, bounded full-page/detail views and exact visual citations (MOCK provider)", async () => {
  // Explicit local image fixture; no claim of a crawled/live brand or model result.
  const bytes = await sharp({
    create: { width: 1440, height: 4000, channels: 3, background: "#cabbaa" },
  })
    .jpeg()
    .toBuffer();
  const row = {
    id: "visual-1",
    source_id: "source-1",
    website_url: "https://example.org/",
    viewport: "desktop",
    object_key: "private/fixture",
    sha256: digest(bytes),
    bytes: bytes.length,
    width: 1440,
    height: 4000,
    observations: {
      images: [
        { loaded: true, box: { x: 0, y: 2700, width: 1000, height: 600 } },
      ],
    },
  };
  const visuals = await prepareVisuals({ read: async () => bytes }, [row]);
  assert.deepEqual(
    visuals.map((i) => i.view),
    ["overview", "hero", "detail"],
  );
  assert.equal(visuals[2].crop.y, 2700);
  assert.equal(visuals[0].height, 2048);
  assert.ok(visuals.every((i) => i.width <= 1440 && i.height <= 2048));
  await assert.rejects(
    prepareVisuals({ read: async () => Buffer.from("corrupted") }, [row]),
    /INTEGRITY/,
  );
  const visionInput = { ...input, visuals };
  assert.throws(
    () => analysisRequest(visionInput, "configured"),
    /AI_VISION_APPROVAL_REQUIRED/,
  );
  const low = analysisRequest(visionInput, "configured", 10000),
    high = analysisRequest(visionInput, "configured", 20000);
  assert.equal(
    high.maxInputTokens - low.maxInputTokens,
    visuals.length * 10000,
  );
  const visionResult = {
    ...result,
    visual_guidance: [
      {
        category: "composition",
        observation: "Muted background in the fixture.",
        creative_direction: "Consider a quiet layout, subject to review.",
        image_ids: [visuals[0].id],
      },
    ],
  };
  const sdk = new OpenAI({
    apiKey: "fixture-only",
    maxRetries: 0,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body),
        content = body.input[0].content,
        images = content.filter((x) => x.type === "input_image");
      assert.equal(images.length, 3);
      assert.ok(
        images.every(
          (i) =>
            i.detail === "high" &&
            i.image_url.startsWith("data:image/jpeg;base64,"),
        ),
      );
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.ok(!JSON.stringify(body).includes("private/fixture"));
      const manifest = JSON.parse(content[0].text).visual_manifest;
      assert.ok(manifest.every((m) => !m.image));
      return Response.json({
        object: "response",
        id: "resp_mock_vision",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify(visionResult),
                annotations: [],
              },
            ],
          },
        ],
      });
    },
  });
  assert.deepEqual(
    (
      await new BrandAnalyzer(undefined, sdk).analyze(
        visionInput,
        "configured",
        10000,
      )
    ).result,
    visionResult,
  );
  const forged = structuredClone(visionResult);
  forged.visual_guidance[0].image_ids = ["other-tenant:overview"];
  assert.throws(
    () => validateAnalysis(forged, visionInput),
    /AI_OUTPUT_INVALID/,
  );
  assert.throws(
    () => validateAnalysis(visionResult, input),
    /AI_OUTPUT_INVALID/,
  );
  assert.throws(
    () =>
      validateAnalysis(
        {
          ...visionResult,
          visual_guidance: [
            { ...visionResult.visual_guidance[0], category: "approved_logo" },
          ],
        },
        visionInput,
      ),
    /AI_OUTPUT_INVALID/,
  );
});
test("crawler blocks nonpublic IPv4/IPv6 and unsafe URL representations", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "100.100.100.200",
    "127.0.0.1",
    "169.254.169.254",
    "168.63.129.16",
    "172.20.1.1",
    "192.168.1.1",
    "198.18.1.2",
    "224.1.1.1",
    "255.255.255.255",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::a00:1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:0808:0808::",
    "3fff::1",
    "3ffe::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicAddress(ip), true, ip);
  for (const url of [
    "file:///etc/passwd",
    "https://user:pass@example.org",
    "http://2130706433/",
    "http://0x7f000001",
    "http://[::1]",
    "http://host.local/",
    "https://example.org:8443",
    "https://example.org/?token=x",
    "https://example.org./",
  ])
    assert.throws(() => websiteURL(url));
  assert.equal(
    websiteURL("https://example.org/about#x").href,
    "https://example.org/about",
  );
});
test("mixed public/private DNS answers fail before opening a socket", async () => {
  let calls = 0;
  const web = new SafeWeb(async () => {
    calls++;
    return [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
  });
  await assert.rejects(
    web.fetch(new URL("https://example.org")),
    /WEBSITE_ADDRESS_BLOCKED/,
  );
  assert.equal(calls, 1);
});
test("robots denial and cross-site redirect stop before target fetch (MOCK transport)", async () => {
  const calls = [];
  const web = {
    fetch: async (u) => {
      calls.push(u.href);
      return {
        status: 200,
        headers: { "content-type": "text/plain" },
        bytes: Buffer.from("User-agent: *\nDisallow: /"),
      };
    },
  };
  await assert.rejects(
    new WebsiteReader(web).read("https://example.org/", async () => []),
    /ROBOTS_DISALLOWED/,
  );
  assert.equal(calls.length, 1);
  const redirs = [];
  const redirect = {
    fetch: async (u) => {
      redirs.push(u.href);
      return u.pathname === "/robots.txt"
        ? { status: 404, headers: {}, bytes: Buffer.alloc(0) }
        : {
            status: 302,
            headers: { location: "http://127.0.0.1/private" },
            bytes: Buffer.alloc(0),
          };
    },
  };
  await assert.rejects(
    new WebsiteReader(redirect).read("https://example.org/", async () => []),
    /UNSAFE_WEBSITE_URL/,
  );
  assert.equal(redirs.length, 2);
});
test("structured OpenAI extraction sends actual SDK contract, no tools/storage/retries (MOCK provider)", async () => {
  let calls = 0;
  const sdk = new OpenAI({
    apiKey: "fixture-only",
    maxRetries: 0,
    fetch: async (url, init) => {
      calls++;
      assert.equal(new URL(url).pathname, "/v1/responses");
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.equal(body.max_output_tokens, 4000);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.match(body.instructions, /UNTRUSTED DATA/);
      return Response.json({
        object: "response",
        id: "resp_fixture",
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
        usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      });
    },
  });
  const response = await new BrandAnalyzer(undefined, sdk).analyze(
    input,
    "configured-text-model",
  );
  assert.deepEqual(response.result, result);
  assert.equal(calls, 1);
});
test("AI output cannot forge citations, duplicate fields or replace reviewed facts", () => {
  assert.deepEqual(validateAnalysis(result, input), result);
  for (const change of [
    (r) => (r.findings[0].quote = "not in the source"),
    (r) => (r.findings[0].chunk_id = "other-tenant"),
    (r) => r.findings.push(r.findings[0]),
    (r) => (r.recommendation.cadence = 99),
    (r) => (r.recommendation.chunk_ids = ["other-tenant"]),
    (r) => (r.extra = true),
  ]) {
    const r = structuredClone(result);
    change(r);
    assert.throws(() => validateAnalysis(r, input), /AI_OUTPUT_INVALID/);
  }
  assert.throws(
    () =>
      validateAnalysis(result, {
        ...input,
        reviewed: [
          { field: "offering", value: "Owner corrected", status: "edited" },
        ],
      }),
    /AI_OUTPUT_INVALID/,
  );
});
test("missing key, refusal, incomplete and malformed AI response produce no fabricated findings", async () => {
  await assert.rejects(
    new BrandAnalyzer().analyze(input, "configured"),
    /AI_NOT_CONFIGURED/,
  );
  for (const response of [
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "no" }] },
      ],
    },
    {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "not json", annotations: [] }],
        },
      ],
    },
  ]) {
    const sdk = new OpenAI({
      apiKey: "fixture-only",
      maxRetries: 0,
      fetch: async () =>
        Response.json({ object: "response", id: "resp_fixture", ...response }),
    });
    await assert.rejects(
      new BrandAnalyzer(undefined, sdk).analyze(input, "configured"),
      /AI_/,
    );
  }
});
