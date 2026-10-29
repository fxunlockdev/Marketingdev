import {validBrandTypography,type BrandTypography} from './brand-typography.js';
export type PostArtwork={text:'headline'|'none';typography?:BrandTypography};
export function validPostArtwork(value:unknown):value is PostArtwork{
 const v=value as PostArtwork;
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['text','typography'].includes(k))&&['headline','none'].includes(v.text)&&(v.typography===undefined||(validBrandTypography(v.typography)&&Object.keys(v.typography).sort().join(',')==='body,headline'&&[v.typography.headline,v.typography.body].every(part=>Object.keys(part).sort().join(',')==='family,weight')));
}
export function artworkDirection(artwork?:PostArtwork):string{
 return artwork?.text==='none'?'Create a clean photographic image without any lettering, words, labels, captions, logos or text. Keep all copy in the post caption.':'Create a clean image without baked-in text, labels or decorative lettering. Leave quiet space near the top for one short editable headline. Keep body copy and calls to action in the post caption.';
}
