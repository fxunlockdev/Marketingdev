// Deterministic JSON-schema instance generator for the local mock model.
// Covers the subset Desvio's strict schemas use: objects, arrays with bounds, enums,
// anyOf, $ref into $defs, const, string length and the three patterns in use.

const WORDS={
 headline:'Made for your mornings',supporting:'Fresh, local and ready when you are',cta:'Visit us today',hook:'What makes a great start to the day?',
 concept:'Show the everyday ritual the business makes better, with real people and real products.',
 caption:'A small moment that makes the day better. Come and see what we have been working on this season.',
 body:'Thoughtful products and friendly service, made for the people of our neighbourhood.',
 summary:'A clear, warm brand that helps local customers start their day well.',
 brief:'Introduce the signature offer with a warm, real-life scene and a single clear message.',
 title:'Your next month of content',strategy:'Lead with the signature offer, prove it with real moments, then invite people in.',
 message:'One clear idea per slide that builds to an invitation.',visual:'Close-up of the signature product in natural light',
 camera:'Slow push-in',text:'Fresh every morning',art_direction:'Natural window light, warm tones, generous negative space for the headline.',
 image_prompt:'A warm, natural-light photograph of the signature product on a simple table, generous negative space at the top, brand colours as accents.',
 pillar:'Everyday rituals',name:'Local regulars',statement:'Finding a reliable place that gets the basics right is harder than it should be.',
 angle:'Show that a better everyday option is close by and easy to choose.',rationale:'Matches what the research says customers value most.',
 purpose:'Keep the brand present in the everyday moments that matter to customers.',life_situation:'Busy local professionals with little time in the morning.',
 relationship_to_problem:'They want quality without a detour.',why_this_brand:'It is close, consistent and friendly.',voice:'Warm, plain and confident.',
 imagery:'Natural light, real customers, products in use.',reason:'Grounded in the research notes.',subject:'Category language',
 direction:'Keep the same palette and fonts and lead with the product.',script:'Open on the product, show it in use, end on the invitation.',
 prompt:'A short vertical clip of the signature product being prepared, natural light.',storyline:'From first sip to a better morning.',
 on_screen_text:'Better mornings',observation:'Photos show warm interiors and real products.',creative_direction:'Use real interiors and warm light.',
};
function textFor(key,min=0,max=500){
 let value=WORDS[key]??Object.entries(WORDS).find(([k])=>key.endsWith(k)||key.startsWith(k))?.[1]??`Mock ${key.replace(/_/g,' ')}`;
 while(value.length<min)value+=' '+value;
 return value.slice(0,max);
}

function resolveRef(root,ref){
 if(!ref.startsWith('#/'))throw new Error(`Unsupported $ref ${ref}`);
 return ref.slice(2).split('/').reduce((node,part)=>node?.[part],root);
}

/** `ctx.path` is the property path; `ctx.index` the position inside the nearest array. */
export function generate(schema,root=schema,ctx={key:'',index:0},overrides={}){
 if(!schema||typeof schema!=='object')return null;
 if(schema.$ref)return generate(resolveRef(root,schema.$ref),root,ctx,overrides);
 const hook=overrides[ctx.key];
 if(hook){const value=hook(schema,ctx);if(value!==undefined)return value;}
 if(Object.hasOwn(schema,'const'))return schema.const;
 if(Array.isArray(schema.enum))return schema.enum[ctx.index%schema.enum.length];
 const options=schema.anyOf??schema.oneOf;
 if(options){
  const usable=options.filter(o=>o.type!=='null');
  return generate(usable.length?usable[(ctx.variant??0)%usable.length]:options[0],root,ctx,overrides);
 }
 const type=Array.isArray(schema.type)?schema.type.find(t=>t!=='null')??'null':schema.type;
 switch(type){
  case 'object':{
   const out={};
   for(const [key,child] of Object.entries(schema.properties??{}))out[key]=generate(child,root,{...ctx,key,parent:ctx.key},overrides);
   return out;
  }
  case 'array':{
   const min=schema.minItems??0,max=schema.maxItems??Math.max(min,3);
   const count=Math.min(max,Math.max(min,schema.items?.enum?1:2));
   return Array.from({length:count},(_,index)=>generate(schema.items,root,{...ctx,index,variant:index},overrides));
  }
  case 'string':return stringFor(schema,ctx);
  case 'integer':if(ctx.key==='position')return ctx.index+1;return Math.max(schema.minimum??1,Math.min(schema.maximum??5,ctx.key.includes('weight')?400:5));
  case 'number':return Math.max(schema.minimum??0,Math.min(schema.maximum??1,1));
  case 'boolean':return ctx.key==='anchor'?ctx.index===0:true;
  case 'null':return null;
  default:return null;
 }
}

function stringFor(schema,ctx){
 const pattern=schema.pattern,bounded=pattern?.match(/^\^\[\\s\\S\]\{(\d+),(\d+)\}\$$/);
 const min=bounded?Number(bounded[1]):schema.minLength??0,max=bounded?Number(bounded[2]):schema.maxLength??500;
 if(pattern&&!bounded){
  if(/^\^#\[/.test(pattern))return ['#1F4E5F','#F2A541','#F7F1E8','#3C6E71'][ctx.index%4];
  const slug=pattern.match(/^\^([a-z]+)_\[1-9\]/);
  if(slug)return `${slug[1]}_${ctx.key==='id'?ctx.index+1:1}`;
 }
 if(/(^|_)url$/.test(ctx.key))return 'https://www.example.com/';
 if(/(^|_)(at|date)$/.test(ctx.key))return new Date().toISOString();
 return textFor(ctx.key,min,max);
}
