export const creativeDirections = {
  normal: 'Use a clear, direct concept and a simple composition. Keep the message easy to understand.',
  creative: 'Explore a distinctive concept, a fresh visual story and an expressive composition while staying recognizably on brand.',
  super: 'Explore an unexpected, bold concept with art-directed composition and strong visual storytelling. Prioritize originality without sacrificing readability or brand fit.',
} as const;
export type Creativity = keyof typeof creativeDirections;
export function directedPrompt(prompt:string,level:Creativity){return `${prompt.trim()}\n\nCreative direction: ${creativeDirections[level]} Preserve approved facts, product appearance and brand constraints; do not invent claims.`;}
export function canvasIntent(prompt:string):'image'|'plan'|'carousel'|'video'{
 if(/\b(plan|calendar|weekly|monthly|daily|(?:week|month)\s+of|\d+\s+posts?)\b/i.test(prompt))return 'plan';
 if(/\b(carousel|slides?)\b/i.test(prompt))return 'carousel';
 if(/\b(video|reel|clip|animate)\b/i.test(prompt))return 'video';
 return 'image';
}
