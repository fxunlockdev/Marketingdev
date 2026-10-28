/** Placement names come from the saved specification, never guessed from dimensions. */
export function postFormatLabel(post:{format?:string;creative_spec?:{placement?:string}|null}){
 if(post.creative_spec?.placement==='reel')return 'Reel';
 if(post.creative_spec?.placement==='story')return post.format==='video'?'Video story':'Image story';
 return post.format==='carousel'?'Carousel':post.format==='video'?'Video':'Image';
}
