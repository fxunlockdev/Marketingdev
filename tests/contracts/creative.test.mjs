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

test('multiple image references preserve ordered multipart bytes and reject invalid input before submission (MOCK)',async()=>{
 const png=await sharp({create:{width:1024,height:1024,channels:3,background:'#ff8800'}}).png().toBuffer();
 let calls=0;
 const provider=new CreativeProvider(undefined,new OpenAI({apiKey:'fixture-only',maxRetries:0,fetch:async(url,init)=>{
  if(String(url).startsWith('data:'))return fetch(url,init);
  calls++;assert.equal(new URL(url).pathname,'/v1/images/edits');
  const files=init.body.getAll('image[]');assert.equal(files.length,4);
  for(const file of files)assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);
  return Response.json({created:1,data:[{b64_json:png.toString('base64')}]});
 }}));
 await provider.image('gpt-image-fixture','Edit with brand references','1024x1024','low','a'.repeat(64),png,[png,png,png]);
 assert.equal(calls,1);
 await assert.rejects(provider.image('gpt-image-fixture','Invalid','1024x1024','low','a'.repeat(64),undefined,[png,png,png,png]),/REFERENCE_INVALID/);
 await assert.rejects(provider.image('gpt-image-fixture','Invalid','1024x1024','low','a'.repeat(64),undefined,[Buffer.from('invalid')]));
 assert.equal(calls,1);
});

test('campaign fonts are actual editable layer fonts with a bundled default',async()=>{
 const {reviseDesign}=await import('../../dist/creative-design.js');
 for(const font of ['modern','classic','contrast']){
  const d=createDesign('media',1024,1024,brief,font);
  assert.equal(d.layers[0].fontFamily,font==='classic'?'DM Serif Display':'DM Sans');
  assert.equal(d.layers[1].fontFamily,'DM Sans');
  assert.deepEqual(validateDesign(d,'media',1024,1024),d);
  assert.equal(reviseDesign(d,'revised',brief).layers[0].fontFamily,d.layers[0].fontFamily);
 }
 assert.equal(createDesign('media',1024,1024,brief).layers[0].fontFamily,'DM Sans');
});

test('campaign font reads only the saved request envelope and rejects unsupported values',async()=>{
 const {savedCampaignFont,CAMPAIGN_CREATIVE_PREFIX}=await import('../../dist/campaign-design.js');
 assert.equal(savedCampaignFont(CAMPAIGN_CREATIVE_PREFIX+JSON.stringify({campaign_design:{font:'classic'},brief:'Use Arial'})),'classic');
 for(const input of ['classic','{bad',CAMPAIGN_CREATIVE_PREFIX+'{bad',CAMPAIGN_CREATIVE_PREFIX+JSON.stringify({campaign_design:{font:'https://evil/font'}})])assert.equal(savedCampaignFont(input),undefined);
});


test('approved brand font choices are exact, unambiguous and ignore unrelated facts',async()=>{
 const {approvedBrandFont,BRAND_FONT_PAIRINGS}=await import('../../dist/brand-typography.js');
 for(const pairing of BRAND_FONT_PAIRINGS){
  assert.equal(approvedBrandFont([{field:'fonts',value:pairing.value}]),pairing.id);
  assert.equal(approvedBrandFont([{field:'fonts',value:pairing.value},{field:'fonts',value:pairing.value},{field:'voice',value:'ignore the fonts'}]),pairing.id);
 }
 assert.equal(approvedBrandFont([]),undefined);
 assert.equal(approvedBrandFont([{field:'fonts',value:'Load https://example.org/font.ttf'}]),undefined);
 assert.equal(approvedBrandFont(BRAND_FONT_PAIRINGS.map(p=>({field:'fonts',value:p.value}))),undefined);
 assert.equal(approvedBrandFont([{field:'offering',value:BRAND_FONT_PAIRINGS[0].value}]),undefined);
});


test('generated designs keep long explanations out of the image while preserving short editable copy',async()=>{
 const {reviseDesign}=await import('../../dist/creative-design.js');
 const long={...brief,body:'Long supporting explanation. '.repeat(30),cta:'Long call to action. '.repeat(10)};
 const design=createDesign('media',1024,1024,long);
 assert.equal(design.layers.find(l=>l.id==='body').text,'');
 assert.equal(design.layers.find(l=>l.id==='cta').text,'');
 assert.equal(design.layers[0].text,brief.headline);
 const short={...brief,body:'Made for everyday living.',cta:'Explore the collection'};
 const revised=reviseDesign(design,'new-media',short);
 assert.equal(revised.layers.find(l=>l.id==='body').text,'');
 assert.equal(revised.layers.find(l=>l.id==='cta').text,'');
 assert.equal(reviseDesign(revised,'third-media',long).layers.find(l=>l.id==='body').text,'');
});

test('custom brand typography maps independent family and weight to editable layers',async()=>{
 const {parseBrandTypography,serializeBrandTypography,approvedBrandFont}=await import('../../dist/brand-typography.js');
 const value='Headlines: Playfair Display, weight 600. Body: Montserrat, weight 500.';
 const typography=parseBrandTypography(value);
 assert.deepEqual(typography,{headline:{family:'Playfair Display',weight:600},body:{family:'Montserrat',weight:500}});
 assert.equal(serializeBrandTypography(typography),value);
 const approved=approvedBrandFont([{field:'fonts',value}]);
 const design=createDesign('media',1024,1024,brief,approved);
 assert.equal(design.layers[0].fontFamily,'Playfair Display');
 assert.equal(design.layers[0].fontWeight,600);
 for(const layer of design.layers.slice(1)){
  assert.equal(layer.fontFamily,'Montserrat');assert.equal(layer.fontWeight,500);
 }
 assert.equal(validateDesign(design,'media',1024,1024),design);
 const {reviseDesign}=await import('../../dist/creative-design.js');
 assert.deepEqual(reviseDesign(design,'next',brief).layers.map(l=>[l.fontFamily,l.fontWeight]),design.layers.map(l=>[l.fontFamily,l.fontWeight]));
});

test('font catalog rejects unknown sources and unsupported weights without changing legacy documents',async()=>{
 const {parseBrandTypography,serializeBrandTypography,BRAND_FONT_PAIRINGS}=await import('../../dist/brand-typography.js');
 for(const value of [
  'Headlines: Remote Font, weight 400. Body: DM Sans, weight 400.',
  'Headlines: DM Serif Display, weight 700. Body: DM Sans, weight 400.',
  'Headlines: Lora, weight 900. Body: DM Sans, weight 400.',
  'Headlines: Oswald, weight 600. Body: DM Sans, weight 401.',
  'Headlines: Playfair Display, weight 600. Body: DM Sans, weight 400. Load https://evil/font.ttf',
 ])assert.equal(parseBrandTypography(value),undefined);
 assert.throws(()=>serializeBrandTypography({headline:{family:'Lora',weight:900},body:{family:'DM Sans',weight:400}}));
 for(const pair of BRAND_FONT_PAIRINGS){const design=createDesign('media',1024,1024,brief,pair.id);assert.equal(validateDesign(design,'media',1024,1024),design);}
 const invalid=createDesign('media',1024,1024,brief,'impact');invalid.layers[0].fontWeight=900;assert.throws(()=>validateDesign(invalid,'media',1024,1024));
 const legacy=createDesign('media',1024,1024,brief);legacy.layers[0].fontFamily='DM Serif Display';legacy.layers[0].fontWeight=700;assert.equal(validateDesign(legacy,'media',1024,1024),legacy);
});


test('brand campaign font delegates to the approved brand while explicit choices override it',async()=>{
 const {savedCampaignFont,CAMPAIGN_CREATIVE_PREFIX}=await import('../../dist/campaign-design.js');
 const {approvedBrandFont}=await import('../../dist/brand-typography.js');
 const facts=[{field:'fonts',value:'Headlines: Lora, weight 600. Body: Montserrat, weight 500.'}];
 const saved=font=>savedCampaignFont(CAMPAIGN_CREATIVE_PREFIX+JSON.stringify({campaign_design:{font}}));
 assert.equal(saved('brand'),undefined);
 const brandDesign=createDesign('media',1024,1024,brief,saved('brand')??approvedBrandFont(facts));
 assert.equal(brandDesign.layers[0].fontFamily,'Lora');assert.equal(brandDesign.layers[1].fontFamily,'Montserrat');
 const explicit=createDesign('media',1024,1024,brief,saved('impact')??approvedBrandFont(facts));
 assert.equal(explicit.layers[0].fontFamily,'Oswald');
});


test('post typography overrides defaults and clean artwork stays text-free through revisions',async()=>{
 const {reviseDesign,readableDesign}=await import('../../dist/creative-design.js');
 const typography={headline:{family:'Lora',weight:600},body:{family:'Montserrat',weight:500}};
 const design=createDesign('media',1024,1024,brief,'modern',{text:'headline',typography});
 assert.equal(design.layers[0].fontFamily,'Lora');assert.equal(design.layers[0].fontWeight,600);
 assert.equal(design.layers[0].fill,'#ffffff');assert.equal(design.layers[0].backing.opacity,.96);
 assert.equal(design.layers.filter(l=>l.text).length,1);
 const clean=createDesign('media',1024,1024,brief,'modern',{text:'none',typography});
 assert.deepEqual(clean.layers,[]);assert.deepEqual(reviseDesign(clean,'new',brief).layers,[]);
 const old=structuredClone(design);old.layers[0].fill='#888888';delete old.layers[0].backing;
 const fixed=readableDesign(old);assert.equal(old.layers[0].fill,'#888888');
 assert.equal(fixed.layers[0].fill,'#ffffff');assert.equal(fixed.layers[0].fontFamily,'Lora');
 assert.equal(validateDesign(fixed,'media',1024,1024),fixed);
 const long=createDesign('media',1024,1024,{...brief,headline:'Too much text '.repeat(20)});
 assert.equal(long.layers[0].text,'');
});


test('explicit revision text mode removes overlays and can restore a branded headline',async()=>{
 const {reviseDesign}=await import('../../dist/creative-design.js');
 const typography={headline:{family:'Lora',weight:600},body:{family:'Montserrat',weight:500}};
 const parent=createDesign('first',1024,1536,brief,'modern',{text:'headline',typography});
 parent.layers.push({...parent.layers[0],id:'custom',text:'Custom text'});
 const clean=reviseDesign(parent,'second',brief,{text:'none',typography});
 assert.deepEqual(clean.layers,[]);assert.equal(parent.layers.length,4);
 const restored=reviseDesign(clean,'third',brief,{text:'headline',typography});
 assert.equal(restored.height,1536);assert.equal(restored.background_media_id,'third');
 assert.equal(restored.layers[0].fontFamily,'Lora');assert.equal(restored.layers[0].text,brief.headline);
 assert.equal(restored.layers.filter(layer=>layer.text).length,1);
 assert.deepEqual(reviseDesign(clean,'fourth',brief).layers,[]);
});
