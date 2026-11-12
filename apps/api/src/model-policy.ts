/** One place that says which model does which job.
 *
 * IDs were read from the account's model list on 2026-11-12. Prices are list prices per
 * million tokens from OpenAI's GPT-6 guide (Astra $10/$50, Sol $2/$10, Luna $0.10/$0.50);
 * one micro-dollar per token equals one dollar per million tokens. Reservations add a
 * margin on input so cache writes and long prompts are never under-reserved.
 *
 * Models that a business is allowed to spend on are still granted per business in the
 * database. This file supplies the values those grants should carry.
 *
 * Reasoning effort is deliberately modest. Reasoning tokens count against each request's
 * output limit, and those limits were sized for low effort. Raise effort only together
 * with the limit, after a live run shows complete outputs.
 */
export type ReasoningEffort='low'|'medium'|'high';
export type TextRole='strategy'|'research'|'brief'|'chat'|'check';
export type ModelRole=TextRole|'image';
type TextEntry={model:string;inputPerMillion:number;outputPerMillion:number;effort:ReasoningEffort};

export const MODEL_POLICY:{readonly [R in TextRole]:TextEntry}&{readonly image:{model:string}}={
 /** Brand strategy, the monthly plan and its storylines, art direction. Few calls, highest judgement. */
 strategy:{model:'gpt-6-astra',inputPerMillion:10,outputPerMillion:50,effort:'medium'},
 /** Web and competitor research with search tools. */
 research:{model:'gpt-6.1-sol',inputPerMillion:2,outputPerMillion:10,effort:'low'},
 /** Per-post creative briefs, carousel plans and the brief critic. */
 brief:{model:'gpt-6.1-sol',inputPerMillion:2,outputPerMillion:10,effort:'low'},
 /** The create chat and composer suggestions. Latency matters more than depth. */
 chat:{model:'gpt-6.1-sol',inputPerMillion:2,outputPerMillion:10,effort:'low'},
 /** High-volume checks: stock queries, extraction, spelling and quality verdicts. */
 check:{model:'gpt-6-luna',inputPerMillion:0.1,outputPerMillion:0.5,effort:'low'},
 /** Images, carousel slides and stories. Not a text model: Astra directs, this renders. */
 image:{model:'gpt-image-2.6-sunburst'},
};

/** Brand Engine 2K policy: generate a master whose long edge is at least 2048 px in the placement's exact
 * aspect, then downsample to the platform size. Keyed by the stored creative's size. Only image models
 * listed in MASTER_2K_MODELS are asked for these sizes; if the provider refuses a size, the legacy
 * 1024-class size is used instead (creative-provider.ts), so an unconfirmed model never blocks a post. */
export const MASTER_2K_SIZES:Readonly<Record<string,string>>={
 '1024x1024':'2048x2048',
 '1024x1280':'1664x2080',
 '1536x1024':'2112x1408',
 '1024x1536':'1408x2112',
 '1080x1920':'1152x2048',
};
const MASTER_2K_MODELS:readonly string[]=[MODEL_POLICY.image.model];
/** The 2K master size for a stored size, or null when this model is not asked for 2K. */
export function masterImageSize(model:string,stored:{width:number;height:number}):string|null{
 return MASTER_2K_MODELS.includes(model)?MASTER_2K_SIZES[`${stored.width}x${stored.height}`]??null:null;
}
/** Highest quality the image API offers; finals use it (Brand Engine: lower quality only for drafts). */
export const IMAGE_QUALITY='high';

/** Margin on input tokens for cache writes; output is reserved at list price. */
const INPUT_RESERVATION_MARGIN=1.25;
/** Models this code used before the policy. In-flight work saved under them must still finish. */
const PREVIOUS_MODELS:Partial<Record<ModelRole,readonly string[]>>={brief:['gpt-6-sol'],chat:['gpt-6-sol']};
const PREVIOUS_EFFORT:Readonly<Record<string,ReasoningEffort>>={'gpt-6-sol':'low'};

export function reservationRates(role:string):{input_micros_per_token:number;output_micros_per_token:number}{
 if(role==='image'||!Object.hasOwn(MODEL_POLICY,role))throw new Error('MODEL_ROLE_HAS_NO_TOKEN_RATES');
 const entry=MODEL_POLICY[role as TextRole];
 return {input_micros_per_token:entry.inputPerMillion*INPUT_RESERVATION_MARGIN,output_micros_per_token:entry.outputPerMillion};
}

/** Effort for a model this policy knows; undefined leaves the provider default untouched. */
export function reasoningEffort(model:string):ReasoningEffort|undefined{
 const roles:TextRole[]=['strategy','research','brief','chat','check'];
 // A model shared by several roles takes the deepest effort any of them asks for.
 const order:ReasoningEffort[]=['low','medium','high'];
 const efforts=roles.filter(role=>MODEL_POLICY[role].model===model).map(role=>MODEL_POLICY[role].effort);
 if(efforts.length)return efforts.reduce((best,effort)=>order.indexOf(effort)>order.indexOf(best)?effort:best);
 return PREVIOUS_EFFORT[model];
}

export function acceptsModel(role:ModelRole,model:string):boolean{
 return MODEL_POLICY[role].model===model||(PREVIOUS_MODELS[role]??[]).includes(model);
}

/** Values an operator should put in each business's grants. Budgets and expiry stay theirs to set. */
export function recommendedGrants(){
 const strategy=reservationRates('strategy'),brief=reservationRates('brief'),research=reservationRates('research');
 return {
  planning:{provider:'openai',model:MODEL_POLICY.strategy.model,...strategy},
  creative:{text_model:MODEL_POLICY.brief.model,image_model:MODEL_POLICY.image.model,quality:IMAGE_QUALITY,...brief},
  onboarding:{model:MODEL_POLICY.research.model,...research},
  insights:{provider:'openai',model:MODEL_POLICY.research.model,...research},
 } as const;
}
