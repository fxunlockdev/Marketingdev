import {test} from 'node:test';
import assert from 'node:assert/strict';
import {editorBrandStyle} from '../../dist/creative-editor-style.js';
import {variantCount,variantPrompt,VARIANT_MAX} from '../../dist/creative-editor-variants.js';

test('editor brand style keeps exact hex colours and a supported font pairing only',()=>{
 const style=editorBrandStyle([
  {field:'colors',value:'Primary #1F4E5F, secondary #f2a541'},
  {field:'colors',value:'Accent #FFF and #1f4e5f again; teal-ish, #12345 is not a colour'},
  {field:'fonts',value:'Headlines: Playfair Display, weight 600. Body: Montserrat, weight 400.'},
  {field:'audience',value:'#000000 is not a palette'},
 ]);
 assert.deepEqual(style,{colors:['#1f4e5f','#f2a541','#ffffff'],typography:{headline:{family:'Playfair Display',weight:600},body:{family:'Montserrat',weight:400}}});
 assert.deepEqual(editorBrandStyle([{field:'fonts',value:'Something handwritten'}]),{colors:[],typography:null});
 const many=editorBrandStyle([{field:'colors',value:Array.from({length:12},(_,i)=>`#0000${String(i).padStart(2,'0')}`).join(' ')}]);
 assert.equal(many.colors.length,8);
});

test('alternatives keep the brief, name a different approach and stay within the prompt limit',()=>{
 assert.equal(VARIANT_MAX,3);
 for(const bad of [0,4,1.5,'2',null])assert.throws(()=>variantCount(bad));
 assert.equal(variantCount(2),2);
 const prompts=[0,1,2].map(i=>variantPrompt('Launch the cardamom bun',i,3));
 assert.equal(new Set(prompts).size,3);
 prompts.forEach((p,i)=>assert.match(p,new RegExp(`^Launch the cardamom bun\\n\\nAlternative ${i+1} of 3: `)));
 assert.ok(variantPrompt('x'.repeat(4000),0,3).length<=4000);
});
