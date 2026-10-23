import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupArguments,setupTarget,setupPayload,setupCommand} from '../../infra/worker-control/configure-providers.mjs';
test('Railway setup requires exact dev scope, pinned image and explicit preview approval',()=>{
 assert.deepEqual(setupArguments(['--list']),{file:'--list',approval:undefined});
 assert.equal(setupArguments(['private.json','--apply','a'.repeat(64)]).approval,'a'.repeat(64));
 for(const args of [[],['--list','--apply','a'.repeat(64)],['x','--apply'],['x','--apply','true'],['x','--unknown'],['x','--apply','a'.repeat(64),'extra']])assert.throws(()=>setupArguments(args));
 const host={project_id:'5427d9ae-d5d0-4e6f-8dcb-52fc8de67e12',environment_id:'6a760b10-9ed8-4f01-9c4a-77a25919755a',id:'e39e62d3-e5b2-4e1a-9a5d-4a6291ecba2b'},inventory={images:[{role:'trusted_worker',image_id:'sha256:'+'a'.repeat(64)}]};
 assert.equal(setupTarget(host,inventory).sandbox,host.id);
 for(const change of [{environment_id:'production'},{project_id:'other'},{id:';unsafe'}])assert.throws(()=>setupTarget({...host,...change},inventory));
 assert.throws(()=>setupTarget(host,{images:[{role:'trusted_worker',image_id:'latest'}]}));
 const command=setupCommand(inventory.images[0].image_id);
 assert.ok(command.includes('--read-only'));assert.ok(command.includes('--tmpfs /tmp:'));assert.ok(!command.includes('docker.sock'));assert.ok(!command.includes('MIGRATION_DATABASE_URL='));
});
test('payload rejects malformed targets and gathers actual migration sources without connection commands',async()=>{
 for(const url of ['https://secret@example.org/db','postgres://example.org/db','postgres://a:b@example.org/'])await assert.rejects(setupPayload(url,null));
 await assert.rejects(setupPayload('postgres://a:b@example.org/db',null,'a'.repeat(64)));
 const payload=await setupPayload('postgres://fixture:private@localhost/postgres',null);
 assert.equal(payload.expectedDatabase,'postgres');assert.ok(payload.migrations['046_carousel_publication.sql']);
 assert.ok(payload.source.includes('CONFIGURATION_PREVIEW_STALE'));
 assert.ok(!setupCommand('sha256:'+'a'.repeat(64)).includes(payload.connectionString));
});
