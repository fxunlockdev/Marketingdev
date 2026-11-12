import {PRODUCTION_SKILL,validStoredSkillSet} from './production-skill-pin.js';
import {CREATIVE_SKILLS} from './creative-skill-pins.js';
import {validLearning} from './learning-context.js';
import {CreativeError,type CreativeInput,type SkillResult} from './creative-contracts.js';

// Generated from the SHA-verified owner archive (scripts/skill_audit.py); update only after re-audit.
export const STRATEGY_SKILLS={
 'desvio-production':PRODUCTION_SKILL,
 'brand-engine':CREATIVE_SKILLS['brand-engine'],
 'product-marketing':CREATIVE_SKILLS['product-marketing'],
 'customer-research':{skill_sha256:'905e65e67268448d88b3b96cf045c6b3615cdd87c1060e129b148a31aa627669',tree_sha256:'102210df37cac15953aeb1168ab37eca5e0aed6c008ddecc14639574e3c8c792'},
 'content-strategy':{skill_sha256:'5097ae8c11c27e2846be307b30f09ac17333fd1ffab1bae19728c81444767001',tree_sha256:'36f4d1fff0923dcbc411b092441853782f4c4ee4e4e5378bba3d6a1b74f9a224'},
 'marketing-psychology':{skill_sha256:'573bbe4f6e300e7fb75299e314f56e26382d284782caa2ae0e0f33eb2e646548',tree_sha256:'915b151bdce1243b8cc5090cef2e75c915af8b8f0b3dc0438bb930f7dbb070cd'},
} as const;
export const STRATEGY_VERSION='deepagents-0.7.29/desvio-strategy-v1';
export const AWARENESS_LEVELS=['unaware','problem_aware','solution_aware','product_aware','most_aware'] as const;
export const STRATEGY_FORMATS=['static','carousel','story','reel'] as const;
/** Size limits shared by the strategy task and the planner inputs built from it. */
export const CONTEXT_LIMITS={evidence:60,evidenceSummary:600,contextPackBytes:60000,notes:20,noteLength:800,snapshotBytes:60000} as const;

export type Evidence={id:string;kind:string;summary:string};
export type StrategyInput={task:'strategy';brand:CreativeInput['brand'];preferences:Record<string,unknown>;evidence?:Evidence[];context_pack?:Record<string,unknown>;market_research?:string[]};
/** Where a strategy item comes from. `unproven` is a labelled hypothesis, never a fact. */
export type Citation={fact_ids:string[];evidence_ids:string[];basis:'proven'|'unproven'};
export type Persona=Citation&{id:string;name:string;life_situation:string;relationship_to_problem:string;why_this_brand:string};
export type Pain=Citation&{id:string;persona_id:string;statement:string;anchor:boolean};
export type Angle=Citation&{id:string;persona_id:string;pain_id:string;awareness:typeof AWARENESS_LEVELS[number];angle:string};
export type FormatChoice={id:string;angle_id:string;format:typeof STRATEGY_FORMATS[number];rationale:string};
export type Pillar=Citation&{id:string;name:string;purpose:string;persona_ids:string[]};
export type BrandStrategy={summary:string;personas:Persona[];pains:Pain[];angles:Angle[];formats:FormatChoice[];pillars:Pillar[];warnings:string[]};
export type StrategyResult=Omit<SkillResult,'brief'>&{strategy:BrandStrategy};
/** What the planner needs from an approved strategy: ids, names and links, not the evidence trail. */
export type StrategySnapshot={id:string;version:number;sha256:string;personas:{id:string;name:string}[];pains:{id:string;persona_id:string;statement:string}[];angles:{id:string;persona_id:string;pain_id:string;awareness:string;angle:string}[];formats:{angle_id:string;format:string}[];pillars:{id:string;name:string;purpose:string}[]};

const CITATION=['fact_ids','evidence_ids','basis'];
const exact=(value:any,keys:string[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const plain=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const rows=(value:unknown,min:number,max:number):value is any[]=>Array.isArray(value)&&value.length>=min&&value.length<=max;
const unique=(values:unknown[])=>new Set(values).size===values.length;
const idOf=(kind:string)=>(value:unknown)=>typeof value==='string'&&new RegExp(`^${kind}_[1-9][0-9]?$`).test(value);
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
/** Opaque JSON from the knowledge graph: an object within the size limit, nothing more is assumed. */
export function validContextPack(value:unknown):value is Record<string,unknown>{try{return !!value&&typeof value==='object'&&!Array.isArray(value)&&bytes(value)<=CONTEXT_LIMITS.contextPackBytes;}catch{return false;}}
export function validNotes(value:unknown):value is string[]{return rows(value,0,CONTEXT_LIMITS.notes)&&value.every(note=>plain(note,CONTEXT_LIMITS.noteLength));}

export function validateStrategyInput(value:any):StrategyInput{
 const fail=():never=>{throw new CreativeError('STRATEGY_INPUT_INVALID');};
 if(!exact(value,['task','brand','preferences',...['evidence','context_pack','market_research'].filter(key=>value?.[key]!==undefined)])||value.task!=='strategy')fail();
 const brand=value.brand;
 if(!exact(brand,['id','sha256','facts',...(brand?.learning===undefined?[]:['learning'])])||(brand.learning!==undefined&&!validLearning(brand.learning))||!plain(brand.id,100)||!/^[a-f0-9]{64}$/.test(brand.sha256)||!rows(brand.facts,1,200)||brand.facts.some((f:any)=>!exact(f,['id','field','value'])||!plain(f.id,100)||!plain(f.field,100)||!plain(f.value,4000))||!unique(brand.facts.map((f:any)=>f.id)))fail();
 if(!value.preferences||typeof value.preferences!=='object'||Array.isArray(value.preferences)||bytes(value.preferences)>20000)fail();
 if(value.evidence!==undefined&&(!rows(value.evidence,1,CONTEXT_LIMITS.evidence)||value.evidence.some((e:any)=>!exact(e,['id','kind','summary'])||!plain(e.id,100)||!plain(e.kind,40)||!plain(e.summary,CONTEXT_LIMITS.evidenceSummary))||!unique(value.evidence.map((e:any)=>e.id))))fail();
 if(value.context_pack!==undefined&&!validContextPack(value.context_pack))fail();
 if(value.market_research!==undefined&&!validNotes(value.market_research))fail();
 if(bytes(value)>390000)fail();
 return value;
}

export function validateStrategy(value:any,input:StrategyInput):BrandStrategy{
 const fail=():never=>{throw new CreativeError('STRATEGY_OUTPUT_INVALID');};
 const facts=new Set(input.brand.facts.map(f=>f.id)),evidence=new Set((input.evidence??[]).map(e=>e.id));
 const cited=(item:any)=>rows(item.fact_ids,0,10)&&rows(item.evidence_ids,0,10)&&unique(item.fact_ids)&&unique(item.evidence_ids)&&item.fact_ids.every((id:unknown)=>facts.has(id as string))&&item.evidence_ids.every((id:unknown)=>evidence.has(id as string))
  &&(item.basis==='unproven'||(item.basis==='proven'&&item.fact_ids.length+item.evidence_ids.length>0));
 if(!exact(value,['summary','personas','pains','angles','formats','pillars','warnings'])||!plain(value.summary,1500)||!rows(value.warnings,0,10)||value.warnings.some((w:unknown)=>!plain(w,500)))fail();
 if(!rows(value.personas,3,4)||!rows(value.pains,3,20)||!rows(value.angles,3,20)||!rows(value.formats,3,20)||!rows(value.pillars,3,6)||bytes(value)>100000)fail();
 // A persona is a type of customer, never a stage of awareness (Brand Engine pillar 1).
 if(value.personas.some((p:any)=>!exact(p,['id','name','life_situation','relationship_to_problem','why_this_brand',...CITATION])||!idOf('persona')(p.id)||!plain(p.name,120)||/\b(un)?aware\b/i.test(p.name)||!plain(p.life_situation,500)||!plain(p.relationship_to_problem,500)||!plain(p.why_this_brand,500)||!cited(p)))fail();
 const personas=new Set<string>(value.personas.map((p:any)=>p.id));
 if(value.pains.some((p:any)=>!exact(p,['id','persona_id','statement','anchor',...CITATION])||!idOf('pain')(p.id)||!personas.has(p.persona_id)||!plain(p.statement,400)||typeof p.anchor!=='boolean'||!cited(p)))fail();
 const painOwner=new Map<string,string>(value.pains.map((p:any)=>[p.id,p.persona_id]));
 if(value.angles.some((a:any)=>!exact(a,['id','persona_id','pain_id','awareness','angle',...CITATION])||!idOf('angle')(a.id)||!personas.has(a.persona_id)||painOwner.get(a.pain_id)!==a.persona_id||!(AWARENESS_LEVELS as readonly unknown[]).includes(a.awareness)||!plain(a.angle,400)||!cited(a)))fail();
 const angles=new Set<string>(value.angles.map((a:any)=>a.id));
 if(value.formats.some((f:any)=>!exact(f,['id','angle_id','format','rationale'])||!idOf('format')(f.id)||!angles.has(f.angle_id)||!(STRATEGY_FORMATS as readonly unknown[]).includes(f.format)||!plain(f.rationale,400)))fail();
 if(value.pillars.some((p:any)=>!exact(p,['id','name','purpose','persona_ids',...CITATION])||!idOf('pillar')(p.id)||!plain(p.name,140)||!plain(p.purpose,400)||!rows(p.persona_ids,1,4)||!unique(p.persona_ids)||p.persona_ids.some((id:unknown)=>!personas.has(id as string))||!cited(p)))fail();
 for(const list of [value.personas,value.pains,value.angles,value.formats,value.pillars])if(!unique(list.map((item:any)=>item.id)))fail();
 // Each persona has pains and angles; one angle per awareness level; one format decision per angle.
 for(const id of personas){
  const pains=value.pains.filter((p:any)=>p.persona_id===id).length,mine=value.angles.filter((a:any)=>a.persona_id===id);
  if(pains<2||pains>5||mine.length<1||mine.length>5||!unique(mine.map((a:any)=>a.awareness)))fail();
 }
 if(value.formats.length!==value.angles.length||!unique(value.formats.map((f:any)=>f.angle_id)))fail();
 return value;
}

export function validateStrategyResult(value:any,input:StrategyInput):StrategyResult{
 const names=Object.keys(STRATEGY_SKILLS);
 if(!exact(value,['type','version','strategy','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!==STRATEGY_VERSION||value.helpers_executed!==false||!Number.isInteger(value.model_calls)||value.model_calls<1||value.model_calls>3||!validStoredSkillSet(value.skills,names)||!Array.isArray(value.reads)||value.reads.length>50)throw new CreativeError('SKILL_OUTPUT_INVALID');
 for(const skill of value.skills){
  const pin=STRATEGY_SKILLS[skill.name as keyof typeof STRATEGY_SKILLS];
  if(!exact(skill,['name','skill_sha256','tree_sha256'])||!pin||skill.skill_sha256!==pin.skill_sha256||skill.tree_sha256!==pin.tree_sha256||!value.reads.includes(`/skills/${skill.name}/SKILL.md`))throw new CreativeError('SKILL_DIGEST_MISMATCH');
 }
 if(value.reads.some((path:unknown)=>typeof path!=='string'||path.includes('..')||!path.endsWith('.md')||(path!=='/.agents/product-marketing.md'&&!names.some(name=>path.startsWith(`/skills/${name}/`)))))throw new CreativeError('SKILL_PATH_DENIED');
 validateStrategy(value.strategy,input);return value;
}

const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
const list=(items:unknown,minItems:number,maxItems:number)=>({type:'array',items,minItems,maxItems});
const slug=(kind:string)=>({type:'string',pattern:`^${kind}_[1-9][0-9]?$`});
/** Provider-side shape. Cross-references and per-persona counts are checked by validateStrategy. */
export function strategySchema(input:StrategyInput):Record<string,unknown>{
 const evidence=(input.evidence??[]).map(e=>e.id);
 const cite={fact_ids:list({$ref:'#/$defs/factId'},0,10),evidence_ids:evidence.length?list({$ref:'#/$defs/evidenceId'},0,10):list({type:'string'},0,0),basis:{type:'string',enum:['proven','unproven']}};
 return {...object({summary:text(1500),
  personas:list(object({id:slug('persona'),name:text(120),life_situation:text(500),relationship_to_problem:text(500),why_this_brand:text(500),...cite}),3,4),
  pains:list(object({id:slug('pain'),persona_id:slug('persona'),statement:text(400),anchor:{type:'boolean'},...cite}),3,20),
  angles:list(object({id:slug('angle'),persona_id:slug('persona'),pain_id:slug('pain'),awareness:{type:'string',enum:[...AWARENESS_LEVELS]},angle:text(400),...cite}),3,20),
  formats:list(object({id:slug('format'),angle_id:slug('angle'),format:{type:'string',enum:[...STRATEGY_FORMATS]},rationale:text(400)}),3,20),
  pillars:list(object({id:slug('pillar'),name:text(140),purpose:text(400),persona_ids:list(slug('persona'),1,4),...cite}),3,6),
  warnings:list(text(500),0,10)}),
  $defs:{factId:{type:'string',enum:input.brand.facts.map(f=>f.id)},...(evidence.length?{evidenceId:{type:'string',enum:evidence}}:{})}};
}

export function strategySnapshot(row:{id:string;version:number;sha256:string;strategy:BrandStrategy}):StrategySnapshot{
 const s=row.strategy;
 return {id:row.id,version:row.version,sha256:row.sha256,personas:s.personas.map(({id,name})=>({id,name})),pains:s.pains.map(({id,persona_id,statement})=>({id,persona_id,statement})),
  angles:s.angles.map(({id,persona_id,pain_id,awareness,angle})=>({id,persona_id,pain_id,awareness,angle})),formats:s.formats.map(({angle_id,format})=>({angle_id,format})),pillars:s.pillars.map(({id,name,purpose})=>({id,name,purpose}))};
}
export function validateStrategySnapshot(value:any):StrategySnapshot{
 const fail=():never=>{throw new CreativeError('STRATEGY_SNAPSHOT_INVALID');};
 if(!exact(value,['id','version','sha256','personas','pains','angles','formats','pillars'])||!/^[0-9a-f-]{36}$/i.test(value.id)||!Number.isInteger(value.version)||value.version<1||!/^[a-f0-9]{64}$/.test(value.sha256))fail();
 if(!rows(value.personas,1,4)||!rows(value.pains,1,20)||!rows(value.angles,1,20)||!rows(value.formats,0,20)||!rows(value.pillars,0,6)||bytes(value)>CONTEXT_LIMITS.snapshotBytes)fail();
 if(value.personas.some((p:any)=>!exact(p,['id','name'])||!idOf('persona')(p.id)||!plain(p.name,120))||!unique(value.personas.map((p:any)=>p.id)))fail();
 const personas=new Set(value.personas.map((p:any)=>p.id));
 if(value.pains.some((p:any)=>!exact(p,['id','persona_id','statement'])||!idOf('pain')(p.id)||!personas.has(p.persona_id)||!plain(p.statement,400))||!unique(value.pains.map((p:any)=>p.id)))fail();
 const owner=new Map(value.pains.map((p:any)=>[p.id,p.persona_id]));
 if(value.angles.some((a:any)=>!exact(a,['id','persona_id','pain_id','awareness','angle'])||!idOf('angle')(a.id)||owner.get(a.pain_id)!==a.persona_id||!(AWARENESS_LEVELS as readonly unknown[]).includes(a.awareness)||!plain(a.angle,400))||!unique(value.angles.map((a:any)=>a.id)))fail();
 const angles=new Set(value.angles.map((a:any)=>a.id));
 if(value.formats.some((f:any)=>!exact(f,['angle_id','format'])||!angles.has(f.angle_id)||!(STRATEGY_FORMATS as readonly unknown[]).includes(f.format)))fail();
 if(value.pillars.some((p:any)=>!exact(p,['id','name','purpose'])||!idOf('pillar')(p.id)||!plain(p.name,140)||!plain(p.purpose,400)))fail();
 return value;
}
