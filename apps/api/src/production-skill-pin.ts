// Audited owner production guidance. Regenerate only after reviewing source changes.
export const PRODUCTION_SKILL = {"skill_sha256": "df95511f1326d0e1338ea3ba32ab4bbcbc3efba98e389e279b9ace93e98901dc", "tree_sha256": "d5cff52315b2328ad324b18acc74ca5667ac7ac15d85210ac91eb126b56df823"} as const;

// Persisted plans retain their original audited manifest. Fresh sandbox results
// must additionally pass hasCurrentProductionRules in SkillRuntime.
export function validStoredSkillSet(skills:unknown, expected:readonly string[]):boolean {
 if(!Array.isArray(skills)||skills.some(s=>!s||typeof s.name!=='string'))return false;
 const names=skills.map(s=>s.name).sort().join(',');
 return names===[...expected].sort().join(',')||names===expected.filter(s=>s!=='desvio-production').sort().join(',');
}
export function hasCurrentProductionRules(value:any):boolean {
 return Array.isArray(value?.skills)&&value.skills.some((s:any)=>s?.name==='desvio-production'&&s.skill_sha256===PRODUCTION_SKILL.skill_sha256&&s.tree_sha256===PRODUCTION_SKILL.tree_sha256)&&Array.isArray(value.reads)&&value.reads.includes('/skills/desvio-production/SKILL.md');
}
