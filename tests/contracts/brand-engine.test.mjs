import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CREATIVE_SKILLS} from '../../dist/creative-skill-pins.js';
import {selectedSkills} from '../../dist/creative-contracts.js';
import {VIDEO_SKILLS} from '../../dist/video-planning.js';
import {PLANNING_SKILLS} from '../../dist/planning-contracts.js';
import {CAROUSEL_SKILLS} from '../../dist/carousel-planning.js';

test('owner Brand Engine archive and required creative skill pins agree without replacing the original archive',()=>{
 const audit=JSON.parse(readFileSync(new URL('../../inventory/brand-engine.json',import.meta.url),'utf8'));
 const bytes=readFileSync(new URL('../../inputs/brand-engine-gpt-2k.zip',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),audit.archive_sha256);
 const pin={skill_sha256:audit.skill_sha256,tree_sha256:audit.tree_sha256};
 for(const skills of [CREATIVE_SKILLS,VIDEO_SKILLS,PLANNING_SKILLS,CAROUSEL_SKILLS])assert.deepEqual(skills['brand-engine'],pin);
 assert.ok(selectedSkills('static').includes('brand-engine'));assert.ok(selectedSkills('ad').includes('brand-engine'));
 assert.equal(audit.helpers_executed,false);
 assert.equal(createHash('sha256').update(readFileSync(new URL('../../inputs/marketingskills-main.zip',import.meta.url))).digest('hex'),'68fe5dc3d3c2c4c0f8936ffe305b1bc9f106011a7fbe4a7048920cebe61bf7eb');
});
