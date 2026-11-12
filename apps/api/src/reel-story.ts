/** Shot counts and the reviewed storyline's shots. Pure, dependency-free: the web app imports this module. */
export const REEL_MIN_SHOTS=2;
export const REEL_MAX_SHOTS=5;
export type StoryShot={visual:string;camera:string;on_screen_text:string};
const flat=(v:unknown):string=>String(v??'').replace(/[\u0000-\u001f\u007f\s]+/g,' ').trim();
/** The reviewed storyline's shots, when the post has a video storyline. */
export function storyShots(storyline:unknown):StoryShot[]{
 const s=storyline as {kind?:unknown;shots?:unknown}|null;
 if(s?.kind!=='video'||!Array.isArray(s.shots))return [];
 return (s.shots as StoryShot[]).filter(x=>x&&typeof x==='object').map(x=>({visual:flat(x.visual),camera:flat(x.camera),on_screen_text:flat(x.on_screen_text)}));
}
/** Shots a reviewed storyline asks for (at most five), or 1 for a single clip. */
export function storylineShotCount(storyline:unknown):number{
 const n=Math.min(REEL_MAX_SHOTS,storyShots(storyline).length);
 return n>=REEL_MIN_SHOTS?n:1;
}
