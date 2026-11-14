import test from 'node:test';
import assert from 'node:assert/strict';
import {egressRuleset,applySandboxEgress,checkSandboxEgress,EGRESS_TABLE,PRIVATE_V4,PRIVATE_V6} from '../../infra/worker-control/sandbox-egress.mjs';
import {startDevWorker} from '../../infra/worker-control/start-dev.mjs';

const state={id:'sandbox',project_id:'p',environment_id:'e'};

test('egress ruleset fences the research bridge off private, metadata and host addresses', () => {
 const rules=egressRuleset();
 for(const net of ['10.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10'])assert.ok(PRIVATE_V4.includes(net),net);
 for(const net of ['fc00::/7','fe80::/10'])assert.ok(PRIVATE_V6.includes(net),net);
 assert.match(rules,new RegExp(`^table inet ${EGRESS_TABLE}\\ndelete table inet ${EGRESS_TABLE}\\n`));
 assert.match(rules,/hook forward priority filter - 10; policy accept;/);
 assert.match(rules,/hook input priority filter - 10; policy accept;/);
 // Every rule is scoped to docker0, so the host-network worker is unaffected.
 for(const line of rules.split('\n').filter(l=>/accept$|drop$/.test(l.trim())&&!/policy/.test(l)))assert.match(line,/iifname "docker0"/,line);
 // DNS to Railway's resolver is allowed before the private drops; then only web ports, then everything else dropped.
 const order=['fd12::10 meta l4proto { tcp, udp } th dport 53 accept','ip daddr @private4 counter drop','ip6 daddr @private6 counter drop','th dport { 80, 443 } accept','udp th dport 443 accept','iifname "docker0" counter drop'].map(s=>rules.indexOf(s));
 assert.ok(order.every(i=>i>0),'all rules present');
 assert.deepEqual([...order].sort((a,b)=>a-b),order,'rules in order');
 // The host input drop must still let IPv6 neighbour discovery through, or the container loses DNS.
 const input=rules.slice(rules.indexOf('chain input'));
 assert.ok(input.includes('iifname "docker0" counter drop'),'host input drop present');
 assert.ok(input.indexOf('nd-neighbor-solicit, nd-neighbor-advert')>0&&input.indexOf('nd-neighbor-solicit')<input.indexOf('counter drop'));
});

test('apply sends the ruleset and refuses to continue unless the table is live', () => {
 let sent;
 const ok=applySandboxEgress(state,(s,program,input)=>{sent={s,program,input};return '{"applied":true,"table":"desvio_sandbox_egress"}\n';});
 assert.equal(ok.applied,true);
 assert.equal(sent.s,state);
 assert.equal(sent.input,egressRuleset());
 assert.match(sent.program,/'nft','-c','-f','-'/);
 assert.throws(()=>applySandboxEgress(state,()=>'{"applied":false,"stage":"check"}'),/WORKER_EGRESS_FIREWALL_FAILED/);
 assert.throws(()=>applySandboxEgress(state,()=>{const e=new Error('exit 1');e.stdout='';throw e;}),/WORKER_EGRESS_FIREWALL_FAILED/);
 assert.throws(()=>applySandboxEgress(state,()=>'not json'),/WORKER_EGRESS_FIREWALL_FAILED/);
});

test('check reports a missing or partial table as not ok', () => {
 assert.equal(checkSandboxEgress(state,()=>'{"present":true,"forward_drop":true,"input_drop":true}').ok,true);
 assert.equal(checkSandboxEgress(state,()=>'{"present":false,"forward_drop":false,"input_drop":false}').ok,false);
 assert.equal(checkSandboxEgress(state,()=>'{"present":true,"forward_drop":true,"input_drop":false}').ok,false);
});

test('worker start applies the firewall first when Agent Reach can run, and stops if it fails', () => {
 assert.throws(()=>startDevWorker({state,values:{AGENT_REACH_IMAGE:'sha256:'+'a'.repeat(64)}},()=>{throw Error('WORKER_EGRESS_FIREWALL_FAILED');}),/WORKER_EGRESS_FIREWALL_FAILED/);
});
