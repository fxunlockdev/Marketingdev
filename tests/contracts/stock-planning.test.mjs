import test from 'node:test';
import assert from 'node:assert/strict';
import {stockQueryRequest,stockSelectionRequest,stockVisionRequest,stockVisualChoice,stockSkipReason,mergeCandidates,stockReferenceLabel,stockQueries,stockSelection} from '../../dist/stock-planning.js';
const response=content=>({content:JSON.stringify(content),tool_calls:[]});
const candidates=[{id:42,title:'Residential courtyard',previewURL:'https://example.com/temporary',aiGenerated:false}];
test('stock query includes approved taste as data and has no external tool access',()=>{
 const request=stockQueryRequest({brand:{facts:[{field:'visual_direction_style',value:'Warm stone and natural light'}]}},'A quiet residential courtyard','vertical');
 assert.deepEqual(request.tools,[]);assert.match(request.messages[1].content,/Warm stone/);assert.equal(request.step,4);
 assert.deepEqual(stockQueries(response({queries:[' courtyard natural light ']})),['courtyard natural light']);
 for(const value of [{queries:['']},{queries:['a\nb']},{queries:['x'.repeat(201)]},{queries:['courtyard'],extra:'instruction'},{queries:[]},{query:'courtyard'}])assert.throws(()=>stockQueries(response(value)),/STOCK_PLAN_INVALID/);
});
test('stock selection is restricted to returned candidates and can decline irrelevant images',()=>{
 const request=stockSelectionRequest('Residential courtyard',candidates);
 assert.equal(request.step,5);assert.doesNotMatch(request.messages[1].content,/temporary/);
 assert.equal(stockSelection(response({resource_id:42}),candidates),42);
 assert.throws(()=>stockSelection(response({resource_id:43}),candidates),/STOCK_PLAN_INVALID/);
 assert.throws(()=>stockSelection(response({resource_id:0}),candidates),/STOCK_NO_RELEVANT_RESULT/);
 assert.throws(()=>stockSelection({...response({resource_id:42}),tool_calls:[{}]},candidates),/STOCK_PLAN_INVALID/);
});
test('the model may propose up to three distinct queries',()=>{
 assert.deepEqual(stockQueries(response({queries:['dental office','Dental Office ','calm waiting room']})),['dental office','calm waiting room']);
 assert.throws(()=>stockQueries(response({queries:['one two','three four','five six','seven eight']})),/STOCK_PLAN_INVALID/);
 assert.equal(stockQueryRequest({brand:{facts:[]}},'x','square').content_plan_schema.properties.queries.maxItems,3);
});
test('search results merge best-first across queries without duplicates and stop at the cap',()=>{
 const photo=id=>({id,title:`t${id}`,previewURL:null,aiGenerated:false});
 assert.deepEqual(mergeCandidates([[photo(1),photo(2)],[photo(2),photo(3)],[photo(4)]]).map(p=>p.id),[1,2,4,3]);
 const many=[0,1,2].map(q=>Array.from({length:12},(_,i)=>photo(q*100+i+1)));
 assert.equal(mergeCandidates(many).length,24);assert.deepEqual(mergeCandidates([]),[]);
});
test('stock is skipped for edits, supplied brand references and type-led layouts only',()=>{
 const base={imagePrompt:'x',orientation:'square'};
 assert.equal(stockSkipReason(base),null);
 assert.equal(stockSkipReason({...base,edit:true}),'STOCK_SKIPPED_EDIT');
 assert.equal(stockSkipReason({...base,brandReferences:2}),'STOCK_SKIPPED_BRAND_REFERENCES');
 for(const archetype of ['type_led','Type-led poster','typographic','no_photo','text-only','quote_card'])assert.equal(stockSkipReason({...base,layoutArchetype:archetype}),'STOCK_SKIPPED_TYPE_LED',archetype);
 for(const archetype of [undefined,null,7,{},'photo_hero','product_on_texture','photo_with_text_overlay'])assert.equal(stockSkipReason({...base,layoutArchetype:archetype}),null,String(archetype));
});
test('visual ranking sends preview bytes as images, never vendor addresses, and returns a use',()=>{
 const list=[...candidates,{id:43,title:'Garden path',previewURL:'https://example.com/other',aiGenerated:false}];
 const request=stockVisionRequest({imagePrompt:'Residential courtyard',artDirection:{layout_archetype:'photo_hero'}},list,[{id:43,mediaType:'image/jpeg',data:'QUJD'},{id:999,mediaType:'image/jpeg',data:'WFla'}]);
 assert.equal(request.step,5);assert.deepEqual(request.images,[{media_type:'image/jpeg',data:'QUJD'}]);
 const text=JSON.stringify(request.messages);assert.doesNotMatch(text,/example\.com|QUJD/);
 assert.deepEqual(JSON.parse(request.messages[1].content).candidates,[{id:42,image_number:null,title:'Residential courtyard'},{id:43,image_number:1,title:'Garden path'}]);
 assert.deepEqual(request.content_plan_schema.properties.use.enum,['base','inspiration']);
 assert.deepEqual(stockVisualChoice(response({resource_id:43,use:'base'}),list),{id:43,use:'base'});
 assert.throws(()=>stockVisualChoice(response({resource_id:0,use:'inspiration'}),list),/STOCK_NO_RELEVANT_RESULT/);
 for(const value of [{resource_id:43},{resource_id:43,use:'copy'},{resource_id:44,use:'base'}])assert.throws(()=>stockVisualChoice(response(value),list),/STOCK_PLAN_INVALID/);
 assert.throws(()=>stockVisionRequest({imagePrompt:'x'},list,[]),/STOCK_PREVIEW_UNAVAILABLE/);
});
test('the image model is told whether the photo is the base or only inspiration',()=>{
 assert.match(stockReferenceLabel('base'),/^Base photograph\. Design the creative on this photograph/);
 assert.match(stockReferenceLabel('inspiration'),/^Visual inspiration only/);
 for(const use of ['base','inspiration'])assert.match(stockReferenceLabel(use),/[Nn]ot the actual business product/);
});

test('the OpenAI planner sends stock previews as low-detail images in the hashed request; Gemini declines images',async()=>{
 const {CreativeProvider}=await import('../../dist/creative-provider.js'),{GeminiPlanner}=await import('../../dist/gemini-planner.js');
 const provider=new CreativeProvider();
 assert.equal(provider.acceptsImages,true);
 const previews=[{id:42,mediaType:'image/jpeg',data:'QUJD'},{id:43,mediaType:'image/jpeg',data:'REVG'}];
 const request=stockVisionRequest({imagePrompt:'A quiet courtyard'},[...candidates,{id:43,title:'Garden',previewURL:null,aiGenerated:false}],previews);
 const wire=provider.plannerRequest({...request,step:1},'MOCK-plan');
 const user=wire.body.input.find(m=>m.role==='user');
 assert.equal(user.content[0].type,'input_text');assert.equal(user.content[0].text,request.messages[1].content);
 assert.deepEqual(user.content.slice(1),[{type:'input_image',image_url:'data:image/jpeg;base64,QUJD',detail:'low'},{type:'input_image',image_url:'data:image/jpeg;base64,REVG',detail:'low'}]);
 // Different pictures, different request hash: a replay can never pair a recorded answer with other images.
 const other=provider.plannerRequest({...request,step:1,images:[{media_type:'image/jpeg',data:'WFla'},request.images[1]]},'MOCK-plan');
 assert.notEqual(other.sha256,wire.sha256);
 // Without images the request is exactly as before.
 const plain=provider.plannerRequest({...request,step:1,images:undefined},'MOCK-plan');
 assert.equal(plain.body.input.find(m=>m.role==='user').content,request.messages[1].content);
 assert.equal(provider.plannerRequest({...request,step:1,images:[]},'MOCK-plan').sha256,plain.sha256);
 // Bounded and strictly shaped.
 for(const images of [Array(25).fill({media_type:'image/jpeg',data:'QUJD'}),[{media_type:'image/png',data:'QUJD'}],[{media_type:'image/jpeg',data:'not base64!'}],[{media_type:'image/jpeg',data:'QUJD',url:'https://example.com/x.jpg'}],'QUJD'])
  assert.throws(()=>provider.plannerRequest({...request,step:1,images},'MOCK-plan'),/SKILL_BROKER_INVALID/);
 assert.throws(()=>provider.plannerRequest({...request,step:1,messages:[request.messages[0]]},'MOCK-plan'),/SKILL_BROKER_INVALID/);
 assert.equal(provider.plannerRequest({...request,step:1,images:Array(24).fill({media_type:'image/jpeg',data:'QUJD'})},'MOCK-plan').body.input.find(m=>m.role==='user').content.length,25);
 const gemini=new GeminiPlanner();
 assert.equal(gemini.acceptsImages,false);
 assert.throws(()=>gemini.plannerRequest({...request,step:1},'gemini-fixture'),/SKILL_BROKER_INVALID/);
});
