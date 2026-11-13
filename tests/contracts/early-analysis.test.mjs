import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchDigest,analysisReady,researchProgress} from '../../dist/early-analysis.js';

const details={social_profile:{platform:'help',handle:''},business_name:'Runwal Enterprises',website:'https://runwal.test/',business_type:'both',industry:'property',cta:'Book a visit',differentiator:'Integrated townships',timing:'',competitors:['Lodha'],priority_offers:'3 BHK',folder_url:'',guidelines:'',references:[]};
const brief={offering:'Residential apartments',audience:'Families buying a first home',market:'Mumbai',goal:'leads',visual_direction:'',must_follow:'No price promises',details};

test('the research digest changes only for answers the analysis reads',()=>{
 const base=researchDigest(brief);
 assert.match(base,/^[a-f0-9]{64}$/);
 // Looks, folder links, files, guidelines, timing and the social profile never restart it.
 for(const looks of [{...brief,visual_direction:'Warm daylight'},{...brief,details:{...details,references:['cafe-warm']}},{...brief,details:{...details,folder_url:'https://drive.test/folder'}},{...brief,details:{...details,guidelines:'Navy and gold'}},{...brief,details:{...details,timing:'Diwali'}},{...brief,details:{...details,social_profile:{platform:'instagram',handle:'runwal'}}}])
  assert.equal(researchDigest(looks),base);
 for(const change of [{...brief,offering:'Villas'},{...brief,audience:'Investors'},{...brief,market:'Pune'},{...brief,goal:'sales'},{...brief,must_follow:'No awards'},
  {...brief,details:{...details,business_name:'ts'}},{...brief,details:{...details,website:'https://other.test/'}},{...brief,details:{...details,business_type:'services'}},{...brief,details:{...details,industry:'local'}},
  {...brief,details:{...details,cta:'Call us'}},{...brief,details:{...details,differentiator:'Green spaces'}},{...brief,details:{...details,competitors:['Godrej']}},{...brief,details:{...details,priority_offers:'Villas'}}])
  assert.notEqual(researchDigest(change),base);
});

test('the early analysis waits until steps 1 and 2 are saved with a name, offering and audience',()=>{
 assert.equal(analysisReady(brief,1),false);
 assert.equal(analysisReady(brief,2),true);
 assert.equal(analysisReady({...brief,audience:''},3),false);
 assert.equal(analysisReady({...brief,offering:' '},3),false);
 assert.equal(analysisReady({...brief,details:{...details,business_name:''}},3),false);
});

test('research progress reports each stage from saved states, with market research best-effort',()=>{
 const p=(over)=>researchProgress({hasWebsite:true,capture:null,captureMarket:null,analysis:null,followupMarket:null,hasFollowup:false,...over});
 assert.deepEqual(p({}),{website:'waiting',market:'waiting',analysis:'waiting'});
 // Website and market run side by side.
 assert.deepEqual(p({capture:'running',captureMarket:'submitted'}),{website:'running',market:'running',analysis:'waiting'});
 assert.deepEqual(p({capture:'running',captureMarket:'succeeded',analysis:'queued'}),{website:'running',market:'done',analysis:'waiting'});
 assert.deepEqual(p({capture:'succeeded',captureMarket:'succeeded',analysis:'running'}),{website:'done',market:'done',analysis:'running'});
 // A refused market call never fails research; a competitor follow-up shows as market work.
 assert.deepEqual(p({capture:'succeeded',captureMarket:'rejected',analysis:'succeeded'}),{website:'done',market:'skipped',analysis:'done'});
 assert.deepEqual(p({capture:'succeeded',captureMarket:'succeeded',analysis:'running',hasFollowup:true,followupMarket:'submitted'}),{website:'done',market:'running',analysis:'running'});
 assert.deepEqual(p({capture:'succeeded',captureMarket:'succeeded',analysis:'succeeded',hasFollowup:true,followupMarket:'succeeded'}),{website:'done',market:'done',analysis:'done'});
 assert.deepEqual(p({analysis:'unknown',capture:'succeeded'}).analysis,'unknown');
 assert.deepEqual(researchProgress({hasWebsite:false,capture:null,captureMarket:null,analysis:'running',followupMarket:null,hasFollowup:false}),{website:'skipped',market:'skipped',analysis:'running'});
});
