// Explicit MOCK provider output for persistence/backward-compatibility tests.
// Actual Maxun adapter contracts/checkpoint/storage tests are in intake.test.mjs.
import sharp from 'sharp';
import {IntakeJobs as ProductionIntakeJobs} from '../../dist/intake-jobs.js';
import {digest} from '../../dist/object-store.js';
export const VISUAL_VERSION='historical-capture-fixture-v1';
export async function fixtureVisual(){
 const snapshots=[];
 for(const width of [1440,390]){
  const bytes=await sharp({create:{width,height:720,channels:3,background:'#f4e8d1'}}).jpeg().toBuffer();
  snapshots.push({viewport:{width,height:720},height:720,truncated:false,sha256:digest(bytes),screenshot:bytes.toString('base64'),observations:{title:'Acme',text:'Acme makes scheduling tools for dental practices.',links:[],images:[],typography:[],colors:[]}});
 }
 return {version:VISUAL_VERSION,url:'https://example.org/',coverage:'rendered_desktop_mobile',requests:0,failures:[],snapshots};
}
class CaptureFixture {
 constructor(visual){this.visual=visual;}
 async capture(_jobs,_scope,url){
  const text='Acme makes scheduling tools for dental practices.',captures=new Map();
  if(this.visual)captures.set(url,{capture:await this.visual.capture(),objects:[]});
  return {pages:[{url,parserVersion:this.visual?VISUAL_VERSION:'mock-capture-v1',sha256:digest(Buffer.from(text+(this.visual?'visual':''))),chunks:[{text,anchor:'fixture:0'}],links:[],truncated:false,coverage:this.visual?'rendered_desktop_mobile':'rendered_provider'}],captures,visualErrors:[],coverage:{pages:[url],skipped:[{url:'https://example.org/about',code:'WEBSITE_ROBOTS_DISALLOWED'}]}};
 }
}
export class IntakeJobs extends ProductionIntakeJobs {
 constructor(jobs,fixture,analyzer,_reader,visual,maxun){super(jobs,analyzer,maxun??(fixture?new CaptureFixture(visual):undefined));}
}
