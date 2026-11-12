/** Alternatives made from one brief: each keeps the message, brand and facts and changes the design approach. */
export const VARIANT_MAX=3;
const APPROACHES=[
 'Use a different layout archetype and composition from the first version, with a new crop of the scene.',
 'Change the lighting, colour emphasis and camera distance; keep the same message.',
 'Make the typography lead: a bolder type-first layout with the scene in a supporting role.',
] as const;
const PROMPT_MAX=4000,NOTE_ROOM=300;

export function variantCount(value:unknown):number{
 if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>VARIANT_MAX)throw new RangeError('VARIANT_COUNT');
 return value;
}

/** The brief for alternative `index` (0-based) of `count`, bounded to the request's prompt limit. */
export function variantPrompt(prompt:string,index:number,count:number):string{
 const approach=APPROACHES[index%APPROACHES.length];
 return `${prompt.slice(0,PROMPT_MAX-NOTE_ROOM).trim()}\n\nAlternative ${index+1} of ${count}: ${approach}`;
}
