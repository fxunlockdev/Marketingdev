import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productPhotoFor,withProductPhotos} from '../../dist/product-photo-match.js';

const ref=(id,label,kind='upload')=>({id,label,kind,sha256:'a'.repeat(64),width:1024,height:1024});
const slot=(over={})=>({format:'static',brief:'Our lavender soap bar for slow mornings',hook:'A calmer start',storyline:{kind:'static',layout_archetype:'product_hero'},...over});
const refs=[ref('logo','Brand logo'),ref('mark','Wordmark white'),ref('soap','Lavender soap bar'),ref('candle','Beeswax candle'),ref('shop','Shopfront','website')];

test('a static post with no chosen reference gets the one approved product photo that best matches its brief or offer',()=>{
 assert.equal(productPhotoFor(slot(),refs,'Handmade soap and candles'),'soap');
 assert.equal(productPhotoFor(slot({brief:'Light up the evening',hook:'Cosy nights'}),refs,'Beeswax candles'),'candle','the offer counts too');
});
test('never a logo, never more than one, never over the planner, and not for type-led or non-static posts',()=>{
 assert.equal(productPhotoFor(slot({brief:'New logo reveal'}),[ref('logo','Brand logo')],''),null,'a logo is never attached');
 assert.equal(productPhotoFor(slot({storyline:{kind:'static',layout_archetype:'type_led_poster'}}),refs,'soap'),null,'type-led posts stay type-led');
 assert.equal(productPhotoFor(slot({format:'carousel'}),refs,'soap'),null);
 assert.equal(productPhotoFor(slot({format:'video'}),refs,'soap'),null);
 assert.equal(productPhotoFor(slot({reference_ids:['candle']}),refs,'soap'),null,'the planner choice stands');
 assert.equal(productPhotoFor(slot({brief:'Meet the team',hook:'Hello'}),[ref('shop','Shopfront','website')],''),null,'an unrelated website image is not forced in');
 assert.equal(productPhotoFor(slot({brief:'Meet the team',hook:'Hello'}),[ref('logo','Logo'),ref('only','Hero bottle')],''),'only','an uploaded product photo is used when nothing matches better');
 assert.equal(productPhotoFor(slot(),[],'soap'),null);
});
test('a plan gains photos only where it chose none, leaving every other slot unchanged',()=>{
 const slots=[slot(),slot({reference_ids:['candle']}),slot({format:'video'})];
 const result=withProductPhotos(slots,refs,[{field:'offering',value:'Handmade soap'}]);
 assert.deepEqual(result.map(s=>s.reference_ids??null),[['soap'],['candle'],null]);
 assert.equal(slots[0].reference_ids,undefined,'input is not mutated');
});
