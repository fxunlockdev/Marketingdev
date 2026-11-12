import test from 'node:test';
import assert from 'node:assert/strict';
import {editSignal} from '../../dist/creative-edit-signal.js';
import {normaliseSignal} from '../../dist/learning-signals.js';

const layer=(id,text,over={})=>({id,text,x:10,y:20,width:300,fontFamily:'DM Sans',fontSize:40,fill:'#111111',...over});
const design=layers=>({layers});
test('canvas edits become a bounded before/after diff plus a layer-change summary',()=>{
 const before={design:design([layer('headline','Old headline'),layer('body','Body'),layer('cta','Book')]),caption:'Caption'};
 const after={design:design([layer('headline','New headline',{x:40}),layer('body','Body',{fontSize:48}),layer('badge','New')]),caption:'Caption'};
 const s=editSignal(before,after);
 assert.equal(s.changed,true);
 assert.deepEqual(s.diff,{headline:{before:'Old headline',after:'New headline'},cta:{before:'Book',after:''}});
 assert.equal(s.reason,'Layer changes: moved headline, resized body, added badge, removed cta');
 // The learning store accepts it unchanged.
 const id='11111111-1111-4111-8111-111111111111';
 assert.deepEqual(normaliseSignal({kind:'edited',creative_version_id:id,diff:s.diff,reason:s.reason}).diff,s.diff);
});
test('no change, malformed designs and oversized edits stay safe and bounded',()=>{
 const same={design:design([layer('headline','Same')]),caption:'C'};
 assert.deepEqual(editSignal(same,same),{diff:{},reason:'',changed:false});
 assert.equal(editSignal({design:null,caption:null},{design:{layers:'x'},caption:7}).changed,false);
 const many=Array.from({length:40},(_,i)=>layer(`l${i}`,'t'));
 const big=editSignal({design:design([layer('headline','a'.repeat(5000))]),caption:''},{design:design(many),caption:'b'.repeat(5000)});
 assert.equal(big.diff.headline.before.length,500);assert.equal(big.diff.caption.after.length,500);
 assert.ok(big.reason.length<=1000);assert.match(big.reason,/and \d+ more$/);
});
