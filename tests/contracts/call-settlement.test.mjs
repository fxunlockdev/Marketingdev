import test from 'node:test';
import assert from 'node:assert/strict';
import {settledMicros,CHARGED_MICROS} from '../../dist/call-settlement.js';
import {reservationRates} from '../../dist/model-policy.js';

const sol={input_micros_per_token:2.5,output_micros_per_token:10};

test('a reported usage settles at the reserved per-token rates, rounded up',()=>{
 // A live plan:1 call: about 26k input and 1.6k output tokens against a $0.40 reservation.
 assert.equal(settledMicros({input_tokens:26000,output_tokens:1600},sol,400000),81000);
 assert.equal(settledMicros({input_tokens:1,output_tokens:0},{input_micros_per_token:0.125,output_micros_per_token:0.5},10),1);
 assert.equal(settledMicros({input_tokens:3,output_tokens:3},{input_micros_per_token:0.1,output_micros_per_token:0.1},10),1);
 assert.equal(settledMicros({input_tokens:0,output_tokens:0},sol,10),0);
 // Database numeric rates and bigint reservations arrive as strings.
 assert.equal(settledMicros({input_tokens:100,output_tokens:100},{input_micros_per_token:'2.5',output_micros_per_token:'10'},'5000'),1250);
});

test('cached input is charged at the full input rate',()=>{
 const usage={input_tokens:25000,output_tokens:130,input_tokens_details:{cached_tokens:24000},output_tokens_details:{reasoning_tokens:100}};
 assert.equal(settledMicros(usage,sol,400000),settledMicros({input_tokens:25000,output_tokens:130},sol,400000));
 assert.equal(settledMicros(usage,sol,400000),63800);
});

test('a settlement never exceeds the reservation',()=>{
 assert.equal(settledMicros({input_tokens:1_000_000,output_tokens:1_000_000},sol,400000),400000);
 assert.equal(settledMicros({input_tokens:10,output_tokens:10},sol,125),125);
});

test('a fixed allowance per hosted tool call is added before the cap',()=>{
 assert.equal(settledMicros({input_tokens:1000,output_tokens:100},sol,1_000_000,75000),78500);
 assert.equal(settledMicros({input_tokens:1000,output_tokens:100},sol,50000,75000),50000);
 for(const fixed of [-1,1.5,NaN,Infinity,'5'])assert.equal(settledMicros({input_tokens:1,output_tokens:1},sol,100,fixed),null);
});

test('without a trustworthy usage report the call keeps its full reservation',()=>{
 const bad=[undefined,null,{},'usage',[],{input_tokens:10},{output_tokens:10},{input_tokens:-1,output_tokens:1},{input_tokens:1.5,output_tokens:1},
  {input_tokens:'10',output_tokens:'10'},{input_tokens:Number.MAX_SAFE_INTEGER+1,output_tokens:0},{input_tokens:NaN,output_tokens:0},
  {prompt_tokens:10,completion_tokens:10},{promptTokenCount:10,candidatesTokenCount:10}];
 for(const usage of bad)assert.equal(settledMicros(usage,sol,400000),null,JSON.stringify(usage));
});

test('invalid rates or reservations never settle',()=>{
 const usage={input_tokens:10,output_tokens:10};
 for(const rates of [undefined,null,{},{input_micros_per_token:2},{input_micros_per_token:-1,output_micros_per_token:1},{input_micros_per_token:'x',output_micros_per_token:1},{input_micros_per_token:Infinity,output_micros_per_token:1},{input_micros_per_token:'',output_micros_per_token:1}])
  assert.equal(settledMicros(usage,rates,400000),null,JSON.stringify(rates));
 for(const reserved of [0,-1,1.5,'abc','',null,undefined,Number.MAX_SAFE_INTEGER+1,'1e3'])assert.equal(settledMicros(usage,sol,reserved),null,String(reserved));
});

test('the inputs are not changed and the policy rates settle as expected',()=>{
 const usage=Object.freeze({input_tokens:4000,output_tokens:200,input_tokens_details:Object.freeze({cached_tokens:10})});
 const rates=Object.freeze(reservationRates('check'));
 assert.equal(settledMicros(usage,rates,100000),600);
});

test('budget queries count a settled call at its settlement and any other at its reservation',()=>{
 assert.equal(CHARGED_MICROS,'COALESCE(settled_micros,reserved_micros)');
});
