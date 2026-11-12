/** Contract for blog articles written by the skills harness on the worker.
 *
 * The API snapshots the request (topic, direction, approved facts, the current article) and
 * the worker runs it through SkillRuntime with copywriting, content-strategy, product-marketing,
 * Brand Engine and the owner's production rules. Whatever the model returns is checked here.
 */
import {PRODUCTION_SKILL,validStoredSkillSet} from './production-skill-pin.js';
import {CREATIVE_SKILLS} from './creative-skill-pins.js';
import {CAROUSEL_SKILLS} from './carousel-planning.js';
import {STRATEGY_SKILLS} from './strategy-contracts.js';
import {CreativeError} from './creative-contracts.js';
import type {PromptKnowledge} from './knowledge-production.js';

// Generated from the SHA-verified owner archive (scripts/skill_audit.py); update only after re-audit.
export const BLOG_SKILLS={
 'desvio-production':PRODUCTION_SKILL,
 'brand-engine':CREATIVE_SKILLS['brand-engine'],
 'product-marketing':CREATIVE_SKILLS['product-marketing'],
 copywriting:CAROUSEL_SKILLS.copywriting,
 'content-strategy':STRATEGY_SKILLS['content-strategy'],
} as const;
export const BLOG_VERSION='deepagents-0.7.29/desvio-blog-v1';
/** A long article is about 10k tokens; the rest is room for reasoning, which shares the limit. */
export const BLOG_OUTPUT_TOKENS=16000;
export const BLOG_LIMITS={topic:4000,context:1800,title:200,body:40000,warnings:10,warning:500,facts:200,fact:4000} as const;

export type BlogFact={id:string;field:string;value:string};
export type BlogArticle={title:string;body:string};
/** What the harness receives. `brand.knowledge` is the context pack, added on the worker. */
export type BlogInput={task:'blog';brand:{facts:BlogFact[];knowledge?:PromptKnowledge};topic:string;context:string;current_article?:BlogArticle};
export type BlogOutput={title:string;body:string;warnings:string[]};
export type BlogResult={type:'result';version:string;article:BlogOutput;skills:{name:string;skill_sha256:string;tree_sha256:string}[];reads:string[];model_calls:number;helpers_executed:false};

const CONTROL=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const plain=(value:unknown,max:number,min=1):value is string=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!CONTROL.test(value);

/** The request a business may send. Throws CreativeError('SKILL_INPUT_INVALID') on anything else. */
export function validateBlogInput(input:unknown):asserts input is BlogInput{
 const fail=():never=>{throw new CreativeError('SKILL_INPUT_INVALID');};
 if(!exact(input,['task','brand','topic','context',...(input&&typeof input==='object'&&'current_article' in input?['current_article']:[])])||input.task!=='blog')return fail();
 const brand=input.brand;
 if(!exact(brand,['facts',...(brand&&typeof brand==='object'&&'knowledge' in brand?['knowledge']:[])])||!Array.isArray(brand.facts)||brand.facts.length>BLOG_LIMITS.facts)return fail();
 if(brand.facts.some(f=>!exact(f,['id','field','value'])||!plain(f.id,100)||!plain(f.field,100)||!plain(f.value,BLOG_LIMITS.fact)))fail();
 if(!plain(input.topic,BLOG_LIMITS.topic)||!plain(input.context,BLOG_LIMITS.context,0))fail();
 const current=input.current_article;
 if(current!==undefined&&(!exact(current,['title','body'])||!plain(current.title,BLOG_LIMITS.title)||!plain(current.body,BLOG_LIMITS.body)))fail();
}

/** Strict output schema; it travels in the broker's planner-schema slot. */
export function blogSchema():Record<string,unknown>{
 const text=(maxLength:number)=>({type:'string',minLength:1,maxLength});
 return {type:'object',additionalProperties:false,required:['title','body','warnings'],properties:{
  title:text(BLOG_LIMITS.title),body:text(BLOG_LIMITS.body),warnings:{type:'array',maxItems:BLOG_LIMITS.warnings,items:text(BLOG_LIMITS.warning)}}};
}

function validateArticle(value:unknown):BlogOutput{
 if(!exact(value,['title','body','warnings'])||!plain(value.title,BLOG_LIMITS.title)||/[\r\n]/.test(value.title)||!plain(value.body,BLOG_LIMITS.body)
  ||!Array.isArray(value.warnings)||value.warnings.length>BLOG_LIMITS.warnings||value.warnings.some(w=>!plain(w,BLOG_LIMITS.warning)))throw new CreativeError('SKILL_OUTPUT_INVALID');
 // The editor renders text, but a stored article must never carry live markup into anything that reuses it.
 if(/<\s*(script|iframe|object|embed|style|link|meta)\b/i.test(value.body))throw new CreativeError('SKILL_OUTPUT_INVALID');
 return {title:value.title.trim(),body:value.body.trim(),warnings:value.warnings.map(w=>w.trim())};
}

/** Checks the harness result: pinned skills, safe reads, bounded calls and a valid article. */
export function validateBlogResult(value:unknown):BlogResult{
 const names=Object.keys(BLOG_SKILLS);
 if(!exact(value,['type','version','article','skills','reads','model_calls','helpers_executed'])||value.type!=='result'||value.version!==BLOG_VERSION||value.helpers_executed!==false
  ||!Number.isInteger(value.model_calls)||Number(value.model_calls)<1||Number(value.model_calls)>3||!validStoredSkillSet(value.skills,names)||!Array.isArray(value.reads)||value.reads.length>50)throw new CreativeError('SKILL_OUTPUT_INVALID');
 const reads=value.reads as unknown[];
 for(const skill of value.skills as unknown[]){
  if(!exact(skill,['name','skill_sha256','tree_sha256']))throw new CreativeError('SKILL_DIGEST_MISMATCH');
  const pin=BLOG_SKILLS[skill.name as keyof typeof BLOG_SKILLS];
  if(!pin||skill.skill_sha256!==pin.skill_sha256||skill.tree_sha256!==pin.tree_sha256||!reads.includes(`/skills/${skill.name}/SKILL.md`))throw new CreativeError('SKILL_DIGEST_MISMATCH');
 }
 if(reads.some(path=>typeof path!=='string'||path.includes('..')||!path.endsWith('.md')||(path!=='/.agents/product-marketing.md'&&!names.some(name=>path.startsWith(`/skills/${name}/`)))))throw new CreativeError('SKILL_PATH_DENIED');
 return {...(value as unknown as BlogResult),article:validateArticle(value.article)};
}
