import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForDeployment} from '../../infra/worker-control/deployment-wait.mjs';
const setup=()=>{let time=0;return {now:()=>time,sleep:async ms=>{time+=ms;},status:async()=>({deploymentId:'new',status:'DEPLOYING'}),id:'new',previous:'old',timeoutMs:10000};};
test('slow deployment observes same ID without retrying mutations',async()=>{const o=setup();o.timeoutMs=30*60*1000;let reads=0;o.status=async()=>({deploymentId:'new',status:++reads>250?'SUCCESS':'DEPLOYING'});await waitForDeployment(o);assert.equal(reads,251);});
test('bounded timeout remains ambiguous and never accepts a previous success',async()=>{const o=setup();o.status=async()=>({deploymentId:'old',status:'SUCCESS'});await assert.rejects(waitForDeployment(o),/DEPLOYMENT_UNCONFIRMED/);assert.equal(o.now(),10000);});
test('replacement drift and terminal failure fail immediately',async()=>{for(const [state,error] of [[{deploymentId:'third',status:'SUCCESS'},/DEPLOYMENT_CHANGED/],[{deploymentId:'new',status:'FAILED'},/DEPLOYMENT_FAILED/]]){const o=setup();o.status=async()=>state;await assert.rejects(waitForDeployment(o),error);assert.equal(o.now(),0);}});
