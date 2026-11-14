/** Plain-language wording for the knowledge page: what each kind of finding is and how sure we are. */

export type KnowledgeOrigin='extracted'|'inferred'|'owner';
export type KnowledgeGroup={type:string;title:string;help:string};

/** Each kind of finding as the question it answers, in the order a business owner thinks about them. */
export const KNOWLEDGE_GROUPS:ReadonlyArray<KnowledgeGroup>=[
 {type:'business',title:'Your business',help:'The name and story posts will use.'},
 {type:'offer',title:'What you sell',help:'Products and services posts can feature.'},
 {type:'positioning',title:'What makes you different',help:'The idea posts keep coming back to.'},
 {type:'audience',title:'Who you serve',help:'The people posts are written for.'},
 {type:'persona',title:'Customer types',help:'Specific people within your audience.'},
 {type:'pain',title:'Problems you solve',help:'What your customers worry about.'},
 {type:'proof_point',title:'Proof you can show',help:'Facts that back up what posts claim.'},
 {type:'angle',title:'Story angles',help:'Ways into a post.'},
 {type:'competitor',title:'Competitors',help:'Who posts should stand apart from. Never copied.'},
 {type:'pillar',title:'Content themes',help:'The topics your calendar rotates through.'},
 {type:'format',title:'Post formats',help:'Formats that suit your business.'},
 {type:'visual_direction',title:'Look and feel',help:'How posts should look.'},
 {type:'voice',title:'How you sound',help:'How posts should read.'},
 {type:'brand_element',title:'Brand elements',help:'Colours, fonts, logos and calls to action.'},
 {type:'rule',title:'Rules to follow',help:'Things posts must or must never do.'},
 {type:'asset',title:'Your files',help:'Photos and documents posts can use.'},
 {type:'post',title:'Posts',help:'Posts that taught us something.'},
 {type:'result',title:'Results',help:'How posts performed.'},
 {type:'lesson',title:'What we have learned',help:'Patterns from your results and feedback.'},
];

/** How a linked finding reads from this item's side, e.g. an offer "For: Working families". */
const FROM:Record<string,string>={targets:'For',solves:'Solves',differentiates_from:'Differs from',proves:'Backs up',expresses:'Shows',
 used_in:'Used in',performed:'Result',contradicts:'Contradicts',supersedes:'Replaces',offers:'Offers',has_pain:'Worries about',
 belongs_to:'Part of',constrains:'Limits',learned_from:'Learned from',related_to:'Linked to'};
/** …and from the other side, e.g. an audience "Served by: Residential projects". */
const TO:Record<string,string>={targets:'Served by',solves:'Solved by',proves:'Backed by',expresses:'Shown in',offers:'Offered by',
 has_pain:'Felt by',contradicts:'Contradicted by',supersedes:'Replaced by',used_in:'Uses',learned_from:'Taught',belongs_to:'Includes',constrains:'Limited by'};

export function relationLabel(relation:string,fromThisSide:boolean):string{
 return (fromThisSide?FROM[relation]:TO[relation])??'Linked to';
}

export type Evidence={source:string;strength:'strong'|'fair'|'weak'|null;strengthLabel:string|null};

/** "From your research · 2 sources" plus a word for confidence instead of a falsely precise percentage. */
export function evidenceFor(node:{origin:KnowledgeOrigin;confidence:number;evidence_count:number}):Evidence{
 if(node.origin==='owner')return {source:'Added by you',strength:null,strengthLabel:null};
 const sources=node.evidence_count?` · ${node.evidence_count} source${node.evidence_count===1?'':'s'}`:'';
 const source=(node.origin==='extracted'?'From your research':'Desvio’s inference')+sources;
 const strength=node.confidence>=0.9?'strong':node.confidence>=0.7?'fair':'weak';
 return {source,strength,strengthLabel:{strong:'Strong evidence',fair:'Some evidence',weak:'Weak evidence'}[strength]};
}
