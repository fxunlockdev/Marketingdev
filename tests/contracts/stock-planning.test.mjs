import test from 'node:test';
import assert from 'node:assert/strict';
import {stockQueryRequest,stockSelectionRequest,stockQuery,stockSelection} from '../../dist/stock-planning.js';
const response=content=>({content:JSON.stringify(content),tool_calls:[]});
const candidates=[{id:42,title:'Residential courtyard',previewURL:'https://example.com/temporary',aiGenerated:false}];
test('stock query includes approved taste as data and has no external tool access',()=>{
 const request=stockQueryRequest({brand:{facts:[{field:'visual_direction_style',value:'Warm stone and natural light'}]}},'A quiet residential courtyard','vertical');
 assert.deepEqual(request.tools,[]);assert.match(request.messages[1].content,/Warm stone/);assert.equal(request.step,4);
 assert.equal(stockQuery(response({query:' courtyard natural light '})),'courtyard natural light');
 for(const value of [{query:''},{query:'a\nb'},{query:'x'.repeat(201)},{query:'courtyard',extra:'instruction'}])assert.throws(()=>stockQuery(response(value)),/STOCK_PLAN_INVALID/);
});
test('stock selection is restricted to returned candidates and can decline irrelevant images',()=>{
 const request=stockSelectionRequest('Residential courtyard',candidates);
 assert.equal(request.step,5);assert.doesNotMatch(request.messages[1].content,/temporary/);
 assert.equal(stockSelection(response({resource_id:42}),candidates),42);
 assert.throws(()=>stockSelection(response({resource_id:43}),candidates),/STOCK_PLAN_INVALID/);
 assert.throws(()=>stockSelection(response({resource_id:0}),candidates),/STOCK_NO_RELEVANT_RESULT/);
 assert.throws(()=>stockSelection({...response({resource_id:42}),tool_calls:[{}]},candidates),/STOCK_PLAN_INVALID/);
});
