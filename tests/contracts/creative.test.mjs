import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import sharp from "sharp";
import { CreativeProvider } from "../../dist/creative-provider.js";
import { validateBrief } from "../../dist/creative-contracts.js";
import { validateDesign, createDesign } from "../../dist/creative-design.js";
const brief = {
  headline: "A calmer day",
  body: "",
  cta: "Discover",
  caption: "Scheduling tools for dental practices",
  image_prompt: "A calm office with space for editable overlays",
  palette: ["#ffffff", "#112233"],
  fact_ids: ["fact-a"],
  warnings: [],
};
const input = {
  brand: {
    facts: [{ id: "fact-a", field: "offering", value: "Scheduling tools" }],
  },
};
test("creative SDK creates and edits actual decodable image bytes with bounded parameters (MOCK provider)", async () => {
  const png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#c0ffee" },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const provider = new CreativeProvider(
    undefined,
    new OpenAI({
      apiKey: "fixture-only",
      maxRetries: 0,
      fetch: async (url, init) => {
        if (String(url).startsWith("data:")) return fetch(url, init);
        calls++;
        if (calls === 1) {
          const body = JSON.parse(init.body);
          assert.equal(new URL(url).pathname, "/v1/images/generations");
          assert.equal(body.n, 1);
          assert.equal(body.output_format, "png");
          assert.equal(body.quality, "low");
          assert.equal(body.safety_identifier, "a".repeat(64));
        } else {
          assert.equal(new URL(url).pathname, "/v1/images/edits");
          assert.equal(init.body.get("image").type, "image/png");
          assert.equal(init.body.get("n"), "1");
        }
        return Response.json({
          created: 1,
          data: [{ b64_json: png.toString("base64") }],
        });
      },
    }),
  );
  const created = await provider.image(
    "gpt-image-fixture",
    "Fixture only",
    "1024x1024",
    "low",
    "a".repeat(64),
  );
  assert.equal(created.width, 1024);
  assert.equal((await sharp(created.bytes).metadata()).format, "png");
  await provider.image(
    "gpt-image-fixture",
    "Edit fixture only",
    "1024x1024",
    "low",
    "a".repeat(64),
    created.bytes,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    provider.image(
      "other-model",
      "Fixture",
      "1024x1024",
      "low",
      "a".repeat(64),
    ),
    /CONFIG_INVALID/,
  );
  assert.equal(calls, 2);
});
test("creative provider rejects invalid image bytes, unexpected dimensions, foreign tools and unsupported model responses", async () => {
  for (const data of [
    [{ url: "https://example.org/remote.png" }],
    [{ b64_json: "Tk9UX0FOX0lNQUdF" }],
  ]) {
    const p = new CreativeProvider(
      undefined,
      new OpenAI({
        apiKey: "fixture",
        maxRetries: 0,
        fetch: async () => Response.json({ created: 1, data }),
      }),
    );
    await assert.rejects(
      p.image("gpt-image-fixture", "x", "1024x1024", "low", "a".repeat(64)),
      /IMAGE_INVALID/,
    );
  }
  const p = new CreativeProvider();
  assert.throws(
    () =>
      p.plannerRequest(
        {
          step: 1,
          messages: [{ role: "user", content: "x" }],
          tools: [{ type: "function", function: { name: "execute" } }],
        },
        "configured",
      ),
    /BROKER_INVALID/,
  );
  const wire = p.plannerRequest(
    { step: 1, messages: [{ role: "user", content: "x" }], tools: [] },
    "configured",
  );
  assert.equal(wire.body.store, false);
  assert.equal(wire.body.max_output_tokens, 4000);
  assert.equal(wire.body.parallel_tool_calls, false);
  assert.ok(wire.maxInputTokens > 2048);
});
test("creative brief citations and editable layers reject forged references and executable or unbounded design fields", () => {
  assert.deepEqual(validateBrief(brief, input), brief);
  assert.throws(
    () => validateBrief({ ...brief, fact_ids: ["other-business"] }, input),
    /BRIEF_INVALID/,
  );
  assert.throws(
    () =>
      validateBrief({ ...brief, palette: ["url(https://evil)", "red"] }, input),
    /BRIEF_INVALID/,
  );
  const d = createDesign("media-a", 1024, 1024, brief);
  assert.deepEqual(validateDesign(d, "media-a", 1024, 1024), d);
  for (const v of [
    { ...d, background_media_id: "other-business" },
    { ...d, url: "https://external" },
    { ...d, layers: [{ ...d.layers[0], fontSize: Infinity }] },
    { ...d, layers: [{ ...d.layers[0], type: "image" }] },
  ])
    assert.throws(
      () => validateDesign(v, "media-a", 1024, 1024),
      /DESIGN_INVALID/,
    );
});
