import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {ONBOARDING_REFERENCES} from '../../dist/onboarding-references.js';
import {LOOK_STYLES,lookStyle} from '../../dist/look-styles.js';
import {BRAND_FONTS} from '../../dist/brand-typography.js';
import {LAYOUT_ARCHETYPES} from '../../dist/image-art-direction.js';
import {directionFromLooks,directionFromResearch,onboardingDirection,brandKitDirection,validateBrandDirection,directionPromptBlock,directionTypography,directionPlanningTheme,contrastRatio,BrandDirectionError} from '../../dist/brand-direction.js';
import {validPostArtwork} from '../../dist/post-artwork.js';

const research={summary:'A family cafe',rationale:'unused',palette:[{role:'primary',hex:'#223344'},{role:'secondary',hex:'#FFFFFF'},{role:'accent',hex:'#FFCC00'}],heading_font:'Lora',body_font:'DM Sans',voice:'Welcoming and plain',imagery:'Real food in natural light',pillars:['Local stories','Everyday rituals'],essential_questions:[],evidence_ids:['e1']};

test('every onboarding look has a complete, reviewed style spec and nothing else does',()=>{
 assert.deepEqual(Object.keys(LOOK_STYLES).sort(),ONBOARDING_REFERENCES.map(r=>r.id).sort());
 for(const ref of ONBOARDING_REFERENCES){
  const s=lookStyle(ref.id);
  assert.ok(s,`${ref.id} has a spec`);
  assert.deepEqual(Object.keys(s).sort(),['body_font','body_weight','heading_font','heading_weight','headline_treatment','imagery','layout_archetype','palette','tone']);
  assert.deepEqual(Object.keys(s.palette).sort(),['accent','background','dominant','headline'],ref.id);
  for(const [role,hex] of Object.entries(s.palette))assert.match(hex,/^#[0-9a-f]{6}$/,`${ref.id} ${role}`);
  for(const [family,weight] of [[s.heading_font,s.heading_weight],[s.body_font,s.body_weight]])assert.ok(BRAND_FONTS.some(f=>f.family===family&&f.weights.includes(weight)),`${ref.id} uses a supported font and weight`);
  assert.ok(LAYOUT_ARCHETYPES.includes(s.layout_archetype),ref.id);
  for(const [field,max] of [['headline_treatment',300],['imagery',800],['tone',200]])assert.ok(s[field].trim().length>=10&&s[field].length<=max,`${ref.id} ${field}`);
  assert.ok(contrastRatio(s.palette.headline,s.palette.background)>=3,`${ref.id} headline reads against its background`);
  assert.ok(existsSync(new URL(`../../apps/web/public${ref.src}`,import.meta.url)),`${ref.id} image exists`);
 }
 assert.equal(lookStyle('not-a-look'),undefined);assert.equal(lookStyle('constructor'),undefined);
});

test('picked looks become the direction: first is primary, the others add layout and imagery variety, research adds voice',()=>{
 const d=directionFromLooks(['still-01','still-02','formae-03'],research,'Calm and unhurried');
 assert.deepEqual(d.looks.map(l=>l.id),['still-01','still-02','formae-03']);
 assert.equal(d.looks[0].src,'/onboarding-references/posts-v2/still-01.webp');
 assert.deepEqual(d.palette,LOOK_STYLES['still-01'].palette);
 assert.equal(d.heading_font,'Lora');assert.equal(d.layout_archetype,'lifestyle_hero');
 assert.deepEqual(d.layout_variety,['lifestyle_hero','comparison']);
 assert.equal(d.imagery_variety.length,2);
 assert.equal(d.voice,'Welcoming and plain');assert.deepEqual(d.pillars,['Local stories','Everyday rituals']);assert.equal(d.notes,'Calm and unhurried');
 assert.deepEqual(validateBrandDirection(d),d);
 assert.throws(()=>directionFromLooks(['still-01','still-01'],research),BrandDirectionError);
 assert.throws(()=>directionFromLooks(['still-01','still-02','formae-03','pace-01'],research),BrandDirectionError);
 assert.throws(()=>directionFromLooks(['made-up'],research),BrandDirectionError);
 assert.throws(()=>directionFromLooks([],research),BrandDirectionError);
});

test('without a picked look the researched direction is used directly, with readable headline colour',()=>{
 const d=onboardingDirection([],research);
 assert.deepEqual(d.looks,[]);
 assert.deepEqual(d.palette,{dominant:'#223344',headline:'#223344',accent:'#ffcc00',background:'#ffffff'});
 assert.equal(d.heading_font,'Lora');assert.equal(d.heading_weight,700);assert.equal(d.body_weight,400);
 assert.equal(d.imagery,'Real food in natural light');
 assert.deepEqual(validateBrandDirection(d),d);
 const pale=directionFromResearch({...research,palette:[{role:'primary',hex:'#eeeeee'},{role:'secondary',hex:'#ffffff'},{role:'accent',hex:'#ff0000'}],heading_font:'DM Serif Display'});
 assert.equal(pale.palette.headline,'#111111');assert.equal(pale.heading_weight,400,'nearest supported weight');
 assert.throws(()=>onboardingDirection([],null),/research/);
 assert.throws(()=>onboardingDirection([],{...research,heading_font:'Comic Sans'}),BrandDirectionError);
});

test('Brand Kit edits: new looks reset visuals, colours and fonts override, voice carries over',()=>{
 const before=directionFromLooks(['still-01'],research);
 const tuned=brandKitDirection(before,{looks:['still-01'],palette:{...before.palette,accent:'#123456'},heading_font:'Playfair Display',heading_weight:700,body_font:'Montserrat',body_weight:300});
 assert.equal(tuned.palette.accent,'#123456');assert.equal(tuned.heading_font,'Playfair Display');assert.equal(tuned.body_weight,300);assert.equal(tuned.imagery,before.imagery);
 const swapped=brandKitDirection(before,{looks:['pace-05','style-ink'],palette:LOOK_STYLES['pace-05'].palette,heading_font:'Montserrat',heading_weight:900,body_font:'DM Sans',body_weight:500});
 assert.equal(swapped.layout_archetype,'type_led_poster');assert.equal(swapped.voice,before.voice);assert.deepEqual(swapped.pillars,before.pillars);
 assert.equal(brandKitDirection(before,{looks:['still-01'],palette:before.palette,heading_font:'DM Serif Display',heading_weight:900,body_font:'DM Sans',body_weight:400}).heading_weight,400);
 assert.throws(()=>brandKitDirection(before,{looks:['still-01'],palette:{...before.palette,accent:'red'},heading_font:'Lora',heading_weight:400,body_font:'DM Sans',body_weight:400}),BrandDirectionError);
 assert.throws(()=>brandKitDirection(before,{looks:['still-01'],palette:before.palette,heading_font:'Arial',heading_weight:400,body_font:'DM Sans',body_weight:400}),/fonts/);
 assert.throws(()=>brandKitDirection(null,{looks:[],palette:before.palette,heading_font:'Lora',heading_weight:400,body_font:'DM Sans',body_weight:400}),/look/);
});

test('stored directions are validated strictly',()=>{
 const d=directionFromLooks(['groomday-05'],research);
 for(const bad of [{...d,extra:1},{...d,palette:{...d.palette,other:'#000000'}},{...d,layout_archetype:'collage'},{...d,layout_variety:['quote']},{...d,headline_treatment:''},{...d,heading_weight:950},{...d,looks:[{id:'groomday-05'}]},{...d,pillars:Array(6).fill('x')},{...d,tone:'a\u0000b'}])
  assert.throws(()=>validateBrandDirection(bad),BrandDirectionError);
});

test('prompt block, typography and planning theme carry the direction as bounded data',()=>{
 const d=directionFromLooks(['oatlet-05','oatlet-04'],research,'x'.repeat(800));
 const full=directionPromptBlock(d),short=directionPromptBlock(d,'short');
 assert.deepEqual(full.palette_roles,d.palette);assert.equal(full.heading_font,'Montserrat 900');assert.deepEqual(full.layout_variety,['lifestyle_hero']);
 assert.equal(full.owner_notes.length,300);assert.equal(short.owner_notes,undefined);assert.ok(JSON.stringify(short).length<JSON.stringify(full).length);
 const artwork=directionTypography(d);
 assert.ok(validPostArtwork(artwork));assert.deepEqual(artwork.typography.headline,{family:'Montserrat',weight:900});
 const theme=directionPlanningTheme(d);
 assert.ok(theme.length<=1200);assert.match(theme,/#fb8743/);assert.match(theme,/Big, playful type/);
});

test('generators receive the stored direction in place of the mood board, bounded to fit the prompt',async()=>{
 const {approvedDirection:imageDirection}=await import('../../dist/image-direction.js');
 const {approvedDirection,directionPromptContext}=await import('../../dist/monthly-plan-approval.js');
 const {buildImagePrompt}=await import('../../dist/image-prompt.js');
 const d=directionFromLooks(['still-01','still-02'],research,'Quiet and calm');
 const image=imageDirection({direction:d,feedback:'',source:'brand_direction'},'Make a post');
 assert.deepEqual(Object.keys(image),['brand_direction']);
 assert.deepEqual(image.brand_direction.palette_roles,d.palette);assert.equal(image.brand_direction.heading_font,'Lora 400');
 assert.equal(imageDirection({direction:{...d,palette:'bad'},feedback:'',source:'brand_direction'},'Make a post'),null,'invalid stored data is dropped');
 const brief={headline:'Hello',body:'',cta:'',caption:'',image_prompt:'A villa at dusk',palette:['#000000','#ffffff'],fact_ids:['f1'],warnings:[],art_direction:{layout_archetype:'lifestyle_hero',text_mode:'overlay',headline_treatment:'Serif',hierarchy:'Headline first',composition:'Wide',lighting:'Golden hour',palette_roles:{dominant:'#9c7e64',headline:'#f2f6eb',accent:'#c3b5a8'},product_placement:'None',logo_placement:'none'}};
 const prompt=buildImagePrompt({brief,identity:[{id:'f1',field:'brand_name',value:'Ellis'}],references:[],hasParent:false,textMode:'overlay',approvedDirection:image});
 assert.match(prompt,/"brand_direction"/);assert.match(prompt,/#26392d/);
 const seen=[];
 const db={query:async(sql)=>{seen.push(sql);if(sql.includes('app.brand_creative_directions'))return {rows:[{id:'d1',version:2,source:'brand_kit',direction:d,created_at:'now',created_by:'u'}]};if(sql.includes('app.guided_moodboards'))return {rows:[{direction:{palette:[{role:'primary',hex:'#112233'}],heading_font:'Lora',body_font:'DM Sans',voice:'Old',imagery:'Old',summary:'Old'},feedback:'Old'}]};return {rows:[{creative_brief:{markets:'Mumbai'}}]};}};
 const found=await approvedDirection(db,'org','brand');
 assert.equal(found.moodboard,null,'the direction replaces an older mood board');assert.deepEqual(found.brand_direction,d);assert.deepEqual(found.creative_brief,{markets:'Mumbai'});
 const block=directionPromptContext(found,4000);
 assert.deepEqual(block.creative_direction.palette_roles,d.palette);assert.equal(block.mood_board,undefined);
 for(const room of [1200,600,400]){const small=directionPromptContext(found,room);assert.ok(small&&JSON.stringify(small).length<=room,`fits ${room}`);assert.deepEqual(small.creative_direction.palette_roles,d.palette);}
});
