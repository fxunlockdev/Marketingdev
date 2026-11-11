import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeBriefSchema,validateBrief} from '../../dist/creative-contracts.js';
import {validArtDirection,artDirectionSchema,LAYOUT_ARCHETYPES,defaultTextMode} from '../../dist/image-art-direction.js';
import {carouselPlanSchema,validateCarouselPlan,carouselSlideBrief} from '../../dist/carousel-planning.js';

const input={brand:{id:'brain',sha256:'a'.repeat(64),facts:[{id:'approved-fact',field:'offering',value:'Pet grooming'}]},prompt:'Make a post',format:'static',channel:'instagram',parent:null};
const legacy={headline:'Fresh coats',body:'',cta:'Book now',caption:'Grooming that dogs enjoy.',image_prompt:'A happy dog after grooming.',palette:['#ffffff','#112233'],fact_ids:['approved-fact'],warnings:[]};
const direction={layout_archetype:'lifestyle_hero',text_mode:'in_image',headline_treatment:'Bold condensed sans, two lines, top left',hierarchy:'Headline, then product, then call to action pill',composition:'Subject on the right third, open wall on the left',lighting:'Soft morning window light',palette_roles:{dominant:'#f4efe6',headline:'#112233',accent:'#ff6b35'},product_placement:'Branded grooming kit on the counter, label facing camera',logo_placement:'bottom_right'};

test('creative brief schema requires a complete art direction object with closed vocabularies',()=>{
 const schema=creativeBriefSchema(['approved-fact']),art=schema.properties.art_direction;
 assert.ok(schema.required.includes('art_direction'));
 assert.deepEqual(art,artDirectionSchema());
 assert.equal(art.additionalProperties,false);
 assert.deepEqual([...art.required].sort(),['composition','headline_treatment','hierarchy','layout_archetype','lighting','logo_placement','palette_roles','product_placement','text_mode']);
 assert.deepEqual(art.properties.layout_archetype.enum,['lifestyle_hero','product_hero','type_led_poster','comparison','offer','quote']);
 assert.deepEqual(art.properties.text_mode.enum,['in_image','overlay','none']);
 assert.deepEqual(art.properties.palette_roles.required,['dominant','headline','accent']);
 assert.equal(art.properties.palette_roles.additionalProperties,false);
});

test('briefs with art direction validate; briefs saved before art direction still validate on replay',()=>{
 assert.deepEqual(validateBrief(legacy,input),legacy);
 assert.deepEqual(validateBrief({...legacy,art_direction:direction},input).art_direction,direction);
});

test('malformed art direction is rejected rather than repaired',()=>{
 const bad=[null,[],{},{...direction,layout_archetype:'collage'},{...direction,text_mode:'baked'},{...direction,extra:true},{...direction,lighting:7},{...direction,composition:'x'.repeat(601)},{...direction,headline_treatment:'bad\u0000text'},{...direction,palette_roles:{dominant:'#fff',headline:'#112233',accent:'#ff6b35'}},{...direction,palette_roles:{...direction.palette_roles,extra:'#000000'}},{...direction,logo_placement:'centre'},(({lighting,...rest})=>rest)(direction)];
 for(const art_direction of bad){
  assert.equal(validArtDirection(art_direction),false);
  assert.throws(()=>validateBrief({...legacy,art_direction},input),e=>e.code==='CREATIVE_BRIEF_INVALID');
 }
 assert.equal(validArtDirection(direction),true);
});

test('each layout archetype has a default text mode: scenes carry designed type, dense layouts stay editable',()=>{
 assert.equal(defaultTextMode('lifestyle_hero'),'in_image');
 assert.equal(defaultTextMode('product_hero'),'in_image');
 for(const archetype of LAYOUT_ARCHETYPES.filter(a=>!['lifestyle_hero','product_hero'].includes(a)))assert.equal(defaultTextMode(archetype),'overlay');
});

const carouselInput={task:'carousel',brand:input.brand,prompt:'Three tips',channel:'instagram',slide_count:2};
const slide=(position,extra={})=>({position,headline:`Tip ${position}`,body:'',cta:'',image_prompt:`Scene ${position}`,alt_text:`Slide ${position}`,fact_ids:['approved-fact'],...extra});
const carousel=(extra={},slides=[slide(1),slide(2)])=>({title:'Tips',caption:'Three tips.',visual_direction:'Warm, calm studio.',palette:['#ffffff','#112233'],warnings:[],slides,...extra});

test('carousel plan schema asks for shared art direction and a text mode per slide',()=>{
 const schema=carouselPlanSchema(carouselInput);
 assert.deepEqual(schema.properties.art_direction,artDirectionSchema());
 assert.ok(schema.required.includes('art_direction'));
 assert.deepEqual(schema.properties.slides.items.properties.text_mode.enum,['in_image','overlay','none']);
 assert.ok(schema.properties.slides.items.required.includes('text_mode'));
});

test('carousel plans saved before art direction replay unchanged; new plans carry direction into every slide brief',()=>{
 const old=carousel();
 assert.deepEqual(validateCarouselPlan(old,carouselInput),old);
 assert.deepEqual(Object.keys(carouselSlideBrief(old,0)).sort(),['body','caption','cta','fact_ids','headline','image_prompt','palette','warnings']);
 const next=carousel({art_direction:{...direction,text_mode:'overlay'}},[slide(1,{text_mode:'in_image'}),slide(2,{text_mode:'overlay',body:'A longer supporting explanation for this slide.'})]);
 assert.deepEqual(validateCarouselPlan(next,carouselInput),next);
 assert.equal(carouselSlideBrief(next,0).art_direction.text_mode,'in_image');
 assert.equal(carouselSlideBrief(next,1).art_direction.text_mode,'overlay');
 assert.equal(carouselSlideBrief(next,1).art_direction.layout_archetype,'lifestyle_hero');
 assert.throws(()=>validateCarouselPlan(carousel({art_direction:{...direction,text_mode:'baked'}}),carouselInput),e=>e.code==='CAROUSEL_PLAN_INVALID');
 assert.throws(()=>validateCarouselPlan(carousel({art_direction:direction},[slide(1,{text_mode:'baked'}),slide(2,{text_mode:'overlay'})]),carouselInput),e=>e.code==='CAROUSEL_PLAN_INVALID');
});
