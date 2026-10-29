import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const catalog=stripTypeScriptTypes(readFileSync('apps/api/src/brand-typography.ts','utf8'));
const catalogUrl='data:text/javascript;base64,'+Buffer.from(catalog).toString('base64');
const source=stripTypeScriptTypes(readFileSync('apps/web/components/design-font-loader.ts','utf8').replace("'../../api/src/brand-typography'",JSON.stringify(catalogUrl)));
const {loadDesignFonts}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('font readiness uses each requested family and weight and deduplicates layers',async()=>{
 const calls=[];
 await loadDesignFonts([{fontFamily:'Playfair Display',fontWeight:600,text:'Title'},{fontFamily:'Montserrat',fontWeight:400,text:'Body'},{fontFamily:'Montserrat',fontWeight:400,text:'Caption'},{fontFamily:'Lora',text:''}],{load:async(spec,text)=>{calls.push({spec,text});return [{}];}});
 assert.deepEqual(calls,[{spec:'600 16px "Playfair Display"',text:'Title'},{spec:'400 16px "Montserrat"',text:'Body Caption'}]);
});
test('missing bundled font definition cannot silently export a fallback',async()=>{
 await assert.rejects(loadDesignFonts([{fontFamily:'Oswald',fontWeight:500,text:'Title'}],{load:async()=>[]}),/Oswald font could not be loaded/);
});
test('font download errors remain failures',async()=>{
 await assert.rejects(loadDesignFonts([{fontFamily:'Lora',text:'Title'}],{load:async()=>{throw Error('Font network error');}}),/Font network error/);
});
test('a stalled font request has a bounded timeout',async()=>{
 await assert.rejects(loadDesignFonts([{fontFamily:'Montserrat',text:'Title'}],{load:()=>new Promise(()=>{})},10),/too long/);
});
test('legacy system fonts do not require a bundled font face',async()=>{
 await loadDesignFonts([{fontFamily:'Arial',fontWeight:700,text:'Saved legacy creative'}],{load:async()=>[]});
});
