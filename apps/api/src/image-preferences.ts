/** What this customer's own decisions say about the picture, as instructions for the image model and
 * the vision check. Derived deterministically from the preference statements saved on the request
 * (learning-signals.ts wording), so a replay produces the same prompt. */
import type {LearningContext} from './learning-context.js';

export type ImageAvoid={key:string;prompt:string;check:string};
export type ImageFeedback={avoid:ImageAvoid[];prefer:string[]};

/** Themes from learning-signals.ts THEMES, as they affect a picture. Copy-only themes are left out. */
const THEMES:readonly {theme:string;key:string;prompt:string;check:string}[]=[
 {theme:'people',key:'people',prompt:'Show no people at all: no faces, figures, hands, silhouettes or reflections of people. Tell the story with the product, the setting and objects.',check:'people, faces, hands or human figures'},
 {theme:'a stock or generic look',key:'generic_look',prompt:'Avoid a generic stock-photo look: no staged poses, no cliché props, nothing that could belong to any business.',check:'generic stock-photo styling'},
 {theme:'the wording',key:'wording',prompt:'Keep visible lettering to the exact approved copy and the brand name only; no extra words, numbers or fake labels.',check:'extra, invented or misspelled wording'},
 {theme:'colour',key:'colour',prompt:'Keep strictly to the approved brand palette; no dominant colours outside it.',check:'dominant colours outside the approved palette'},
 {theme:'being off-brand',key:'off_brand',prompt:'Stay strictly on brand: approved palette, the brand typography character and only the real logo.',check:'off-brand styling or an invented logo'},
 {theme:'a busy layout',key:'busy_layout',prompt:'One focal subject with generous negative space; no clutter, collage or crowded props.',check:'a busy, cluttered layout'},
];
const REJECTION=/^(Rejection reasons|Change requests) mention (.+):/;
const LAYOUT=/^Rejects (lifestyle_hero|product_hero|type_led_poster|comparison|offer|quote) layouts:/;
const PREFER=/^Approves (.+?):/;

/** Avoid and prefer instructions from the saved learning context; empty when there is nothing visual. */
export function imageFeedback(learning:LearningContext|null|undefined):ImageFeedback{
 const avoid:ImageAvoid[]=[],prefer:string[]=[];
 for(const entry of Array.isArray(learning)?learning:[]){
  if(entry.kind!=='customer_preference')continue;
  const rejected=REJECTION.exec(entry.statement),layout=LAYOUT.exec(entry.statement),approved=PREFER.exec(entry.statement);
  const theme=rejected?THEMES.find(t=>t.theme===rejected[2]):undefined;
  if(theme&&!avoid.some(a=>a.key===theme.key))avoid.push({key:theme.key,prompt:theme.prompt,check:theme.check});
  else if(layout&&!avoid.some(a=>a.key===`layout_${layout[1]}`))avoid.push({key:`layout_${layout[1]}`,prompt:`Do not compose this as a ${layout[1].replaceAll('_',' ')} layout.`,check:`a ${layout[1].replaceAll('_',' ')} layout`});
  else if(approved)prefer.push(`The customer approves ${approved[1].replaceAll('_',' ')}.`);
 }
 return {avoid,prefer:prefer.slice(0,4)};
}

/** Image prompt section; empty string when the customer has said nothing about pictures. */
export function feedbackSection(feedback:ImageFeedback):string{
 if(!feedback.avoid.length&&!feedback.prefer.length)return '';
 return ['CUSTOMER FEEDBACK (from this customer\'s own rejections and approvals; it overrides the creative task where they conflict):',
  ...feedback.avoid.map(a=>`- Must avoid: ${a.prompt}`),
  ...feedback.prefer.map(p=>`- Prefer: ${p}`)].join('\n');
}
