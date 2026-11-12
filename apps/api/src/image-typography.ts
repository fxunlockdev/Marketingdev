import type {CreativeBrief} from './creative-contracts.js';
import type {TextMode} from './image-art-direction.js';
import {artworkDirection,type PostArtwork} from './post-artwork.js';

/** Longer headlines are where image models start to misspell; they stay editable layers. */
export const IN_IMAGE_HEADLINE_MAX=60;
export const IN_IMAGE_CTA_MAX=28;
/** Same threshold the overlay layout uses for a supporting line. */
const BODY_HEAVY=120;

export type ParentText={hasOverlayText:boolean;textMode?:TextMode};
export type TextModeInput={brief:CreativeBrief;artwork?:PostArtwork;parent?:ParentText|null};
export type InImageCopy={headline:string;cta:string};

function renderable(brief:CreativeBrief):boolean{
 const headline=brief.headline.trim();
 return headline.length>0&&headline.length<=IN_IMAGE_HEADLINE_MAX&&!/[\r\n]/.test(headline)&&brief.body.trim().length<=BODY_HEAVY;
}

/** Decide where the copy lives. Builds on the customer's existing artwork choice ('none'|'headline'). */
export function resolveTextMode({brief,artwork,parent}:TextModeInput):TextMode{
 const direction=brief.art_direction;
 // Briefs saved before art direction: exactly the earlier behaviour.
 if(!direction)return artwork?.text==='none'?'none':'overlay';
 const designed=direction.text_mode==='in_image'&&renderable(brief);
 // The previous picture already carries designed type. An empty overlay there says nothing
 // about whether the customer wants words, so the new brief decides.
 if(parent?.textMode==='in_image')return designed?'in_image':direction.text_mode==='none'?'none':'overlay';
 if(artwork?.text==='none')return 'none';
 if(parent?.hasOverlayText)return 'overlay';
 if(designed)return 'in_image';
 return direction.text_mode==='none'&&artwork?.text!=='headline'?'none':'overlay';
}

/** The exact words the image model must set. A long call to action stays in the caption. */
export function inImageCopy(brief:CreativeBrief):InImageCopy{
 const cta=brief.cta.trim();
 return {headline:brief.headline.trim(),cta:cta.length<=IN_IMAGE_CTA_MAX&&!/[\r\n]/.test(cta)?cta:''};
}

/** First paragraph of the image prompt: what lettering, if any, belongs in the picture. */
export function typographyDirection(mode:TextMode,brief:CreativeBrief,artwork?:PostArtwork,brandName=''):string{
 if(mode==='none')return artworkDirection({text:'none'});
 if(mode==='overlay')return artworkDirection(artwork?.text==='none'?undefined:artwork);
 const copy=inImageCopy(brief),direction=brief.art_direction;
 return [
  `Typography is part of this design, set by a senior art director. Render this headline exactly, character for character, once: ${JSON.stringify(copy.headline)}.`,
  direction?`Headline treatment: ${direction.headline_treatment} Headline colour ${direction.palette_roles.headline}, with strong contrast against what is behind it.`:'',
  copy.cta?`Render this call to action exactly, once, as a small button or pill in the accent colour${direction?` ${direction.palette_roles.accent}`:''}: ${JSON.stringify(copy.cta)}.`:'',
  'Letterforms must be crisp, evenly spaced and fully inside the frame, never cropped, warped, duplicated or misspelled. Keep the same language, capitalisation, punctuation and accents as written.',
  `Render no other words, letters, numbers, captions or watermarks anywhere, including on products, signs, screens and clothing${brandName?`, except the brand name ${JSON.stringify(brandName)} spelled exactly where it naturally appears on the brand's own product or signage`:''}. Lettering visible in an approved reference image may be kept as it is.`,
 ].filter(Boolean).join(' ');
}
