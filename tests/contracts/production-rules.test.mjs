import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PRODUCTION_SKILL} from '../../dist/production-skill-pin.js';
import {CREATIVE_SKILLS} from '../../dist/creative-skill-pins.js';
import {INSIGHT_SKILLS} from '../../dist/insight-skill-pins.js';
import {VIDEO_SKILLS} from '../../dist/video-planning.js';
import {PLANNING_SKILLS} from '../../dist/planning-contracts.js';
import {CAROUSEL_SKILLS} from '../../dist/carousel-planning.js';
import {selectedSkills} from '../../dist/creative-contracts.js';
test('all planning contracts require the audited production rules with immutable provenance',()=>{
 const a=JSON.parse(readFileSync(new URL('../../inventory/desvio-production.json',import.meta.url)));
 assert.deepEqual(PRODUCTION_SKILL,{skill_sha256:a.skill_sha256,tree_sha256:a.tree_sha256});
 for(const registry of [CREATIVE_SKILLS,VIDEO_SKILLS,PLANNING_SKILLS,CAROUSEL_SKILLS,INSIGHT_SKILLS])assert.deepEqual(registry['desvio-production'],PRODUCTION_SKILL);
 for(const f of ['static','ad'])assert.ok(selectedSkills(f).includes('desvio-production'));
});

// Private methods are provisioned separately from this public repository.
const archive=new URL('../../inputs/desvio-production.zip',import.meta.url);
const source=new URL('../../inputs/desvio-owner-rules-20261109.md',import.meta.url);
test('provisioned private archive and original source match their reviewed hashes', {skip:!existsSync(archive)||!existsSync(source)},()=>{
 const inventory=JSON.parse(readFileSync(new URL('../../inventory/desvio-production.json',import.meta.url)));
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 assert.equal(hash(archive),inventory.archive_sha256);
 assert.equal(hash(source),inventory.source_sha256);
});
