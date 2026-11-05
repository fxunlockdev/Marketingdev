// Curated shot directions from the supplied Runway reference, plus business scenes.
// Multiword subjects outrank individual terms (e.g. mountain farm stay vs mountain).
type Shot=[title:string,terms:string,direction:string];
const shots:Shot[]=[
 ['An architectural reveal','real estate|realty|residential|residences|residence|property|apartments|apartment|luxury home|villa','Start close on the facade, with warm light grazing its surface. Rise slowly along its edge until the building fills the frame, keeping the architecture steady.'],
 ['A tower above the city','skyscraper|tower|high rise|skyline','Frame the tower from street level. Tilt smoothly up its facade as reflections travel across the glass, then settle with the crown against open sky.'],
 ['Arriving at the farm stay','farm stay|farmstay|farm|farmhouse|rural retreat','Open low beside the farm path, grasses moving in the foreground. Glide toward the guesthouse as it comes into view, then hold on the arrival.'],
 ['First light on the ridge','mountain|mountains|valley|peak|hiking|trek','Begin at the edge of the valley with mist drifting across the foreground. Rise slowly until the ridge clears the mist and catches the first light.'],
 ['From the pass to the plate','restaurant|chef|dining|bistro|food','Frame the dish at counter height. Follow the chef’s hand as it places the finishing touch, then shift focus onto the texture of the plate.'],
 ['The first pour','cafe|coffee|espresso|barista|cappuccino','Hold close on the espresso stream as it meets the cup. Ease forward through the steam, with side light catching the crema as the pour settles.'],
 ['A business in motion','business|office|consulting|team|company','Begin on the detail of a task in progress. Pull back gently to reveal the people behind the work, ending on a natural exchange between colleagues.'],
 ['Reflections after rain','neon|rainy street|neon street|rain soaked','Track forward at puddle height. Neon reflections break as a figure crosses the street, then resolve as the frame settles.'],
 ['A highway at sunset','highway|vintage car|desert road','Track alongside the moving car at wheel height. Keep its profile steady as heat haze softens the distant road.'],
 ['Under a single light','interrogation|thriller','Hold the face under a single overhead light. Push in slowly while a thin veil of haze passes through the light behind the subject.'],
 ['Below the surface','underwater|sunken|diving','Drift steadily between submerged shapes as shafts of light move across their surfaces. Let fine suspended particles reveal the depth.'],
 ['Glass and soft light','perfume|fragrance|bottle','Orbit the bottle a few degrees against a quiet studio background. Let a narrow highlight travel over the glass, finishing with the label facing camera.'],
 ['A sneaker in suspension','sneaker|shoe|footwear','Frame the shoe in profile as a small splash curls around its sole. Move through a shallow arc and hold on the silhouette.'],
 ['One drop in focus','skincare|serum|cosmetic','Frame a single serum drop in macro. Hold the camera steady as it lands and a soft highlight travels across the surface.'],
 ['A product unfolds','gadget|smartphone|device|technology','Begin on one material detail, then ease back as the device opens into view. Keep its proportions and finish consistent.'],
 ['A living portrait','portrait|headshot','Keep the framing steady as the subject looks toward the light. A small breath and a natural blink bring the portrait to life.'],
 ['Depth in a landscape','landscape|scenery','Glide gently past a foreground detail while the distant landscape stays steady. Let the layers separate naturally.'],
 ['A mark in light','logo|wordmark','Hold the exact mark in frame as a soft band of light travels across it, ending on its original shape and color.'],
 ['A painting stirs','painting|canvas art','Preserve the composition and brushwork. Let a single element of the painted scene move while the camera holds.'],
 ['A product in profile','product|retail|merchandise','Move in a slow half-orbit around the product. Trace one edge with a soft highlight and settle on the clearest view of its form.'],
 ['A closer look','dolly|push in','Use one gradual push toward the subject. Keep the focus anchored while the background gently falls away.'],
 ['Around the subject','orbit|turntable','Trace a smooth arc around the subject at a constant distance, keeping its proportions and the horizon stable.'],
 ['A rising reveal','crane|reveal','Start behind a foreground detail and rise just enough to uncover the subject, then let the final frame breathe.'],
 ['A matched transition','whip pan','Pan briskly from the first subject, carry the motion through a moment of blur and settle on a matching shape.'],
 ['One continuous flight','fpv|flythrough|drone','Follow one clear flight path through the scene. Pass a near detail for scale before easing into a wider final view.'],
 ['Light over ice','aurora|glacier|northern lights','Lock the camera above the ice as ribbons of light drift across the sky and their color travels through the reflections.'],
 ['Color in suspension','ink|pigment','Hold a macro frame as two ribbons of ink curl through clear water. Let their edges meet slowly in the center.'],
 ['Petals opening','flower|bloom|florist','Keep a steady macro frame as the petals open, with soft side light revealing their changing texture.'],
 ['A glowing surface','lava|volcano','Track slowly alongside the flow as the dark surface parts and reveals the glow beneath.'],
 ['A corridor of light','light tunnel|geometric','Glide straight through repeating bands of light, keeping the vanishing point fixed as each band passes.'],
 ['A particle drift','particles|dissolve','Hold the subject in silhouette as its edge separates into a fine drift, moving consistently with the breeze.'],
 ['A matched portrait','morph|faces','Keep both faces aligned in the same light while their features transition smoothly in one steady frame.'],
 ['A liquid transition','liquid splash|splash transition','Let a sheet of liquid cross the lens and reveal the next view as it falls, preserving the direction of motion.'],
 ['A suspended moment','bullet time|time freeze','Hold the action at its peak and move in a small arc around it, revealing depth in the suspended details.'],
 ['A brief signal shift','glitch|warp','Lock the composition, briefly offset its color channels, then resolve cleanly to the original subject.'],
];
export type Idea={title:string;direction:string};
const normalize=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const catalog=shots.map(([title,terms,direction])=>({title,terms:terms.split('|'),direction}));
const starterWords='create make generate design write show give need want would like can could you me i we us please a an the some new quick short long luxury cinematic about of for my our this that to in on with and video videos film image images photo post posts reel reels carousel story campaign strategy'.split(' ');
const starterFragments=new Set(starterWords.flatMap(word=>Array.from({length:word.length},(_,i)=>word.slice(0,i+1))));
export function hasPromptTopic(draft:string){
 return normalize(draft).split(' ').some(word=>word.length>=3&&!starterFragments.has(word));
}
export function libraryIdeas(draft:string,context:string,format:string):Idea[]{
 if(!hasPromptTopic(draft))return [];
 const typed=normalize(draft);
 const source=' '+(/\b(my|our) (brand|business|company)\b/.test(typed)?typed+' '+normalize(context):typed)+' ';
 const scored=catalog.map(shot=>({shot,score:Math.max(0,...shot.terms.map(term=>source.includes(' '+term+' ')?term.length:0))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 const motion=/\b(video|reel|film|animate|animation)\b/.test(typed)||['reel','video'].includes(format);
 const still=!motion&&(/\b(image|photo|photograph|poster|carousel)\b/.test(typed)||['image','carousel'].includes(format));
 if(!scored.length){
  if(typed.length<5)return [];
  return still?[{title:'Frame the subject',direction:'Choose one focal detail. Keep its silhouette clear and use the surroundings to give a sense of scale.'}]
   :[{title:'From detail to scene',direction:'Begin on a distinctive detail of the subject and reveal how it fits into its surroundings. Hold the final composition long enough to recognize it.'}];
 }
 if(!still&&/\b(locked|fixed|static camera|stationary|tripod|no camera (motion|movement)|camera still)\b/.test(typed)){
  return [{title:'A locked-off study',direction:'Hold the requested framing throughout. Let small changes within the scene draw the eye to the subject.'}];
 }
 if(still&&scored.length){
  const details:Record<string,string>={
   'An architectural reveal':'Frame the facade from a low three-quarter angle. Keep verticals straight, and use raking light to pick out the materials.',
   'A tower above the city':'Set the tower against a clear section of sky. Let a street-level detail in the foreground establish scale.',
   'Arriving at the farm stay':'Frame the farm path as a leading line, with the guesthouse beyond and soft grass at the edge of the frame.',
   'First light on the ridge':'Layer the foreground ridge against the distant peak. Catch the first light along its edge above the valley mist.',
   'From the pass to the plate':'Frame the dish just above counter height. Use soft side light and leave the background quiet so its textures stand out.',
   'The first pour':'Catch the espresso stream just as it meets the crema. Frame the cup tightly against a soft, warm background.'
  };
  const matched=scored.filter(x=>details[x.shot.title]).slice(0,2);
  if(matched.length)return matched.map(x=>({title:x.shot.title,direction:details[x.shot.title]}));
  return [{title:'Frame the subject',direction:'Compose the main subject against a quieter background. Use directional light to bring out its texture, with enough space around the silhouette to read at phone size.'}];
 }
 return scored.slice(0,2).map(({shot})=>({title:shot.title,direction:shot.direction}));
}
export function composeIdea(draft:string,idea:Idea){
 return draft.trim()+'\n'+idea.direction;
}
