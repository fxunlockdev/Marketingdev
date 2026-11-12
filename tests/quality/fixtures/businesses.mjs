/** Three fixed sample businesses for the quality harness: research facts, the locked mood board,
 * learned preferences, a knowledge pack and art-directed briefs. Everything here is invented
 * TEST data. Briefs are fixed so a run measures the image path, not the planner's mood. */
const sha = c => c.repeat(64);
const fact = (id, field, value) => ({id, field, value});
const pref = (statement, count, of) => ({kind: 'customer_preference', statement, count, of, last_seen: '2026-11-10T09:00:00.000Z'});
const art = (o) => ({layout_archetype: 'lifestyle_hero', text_mode: 'in_image', logo_placement: 'top_left', ...o});

const knowledge = (items) => ({task: 'creative', truncated: false,
  notice: 'Items marked "unproven" are unreviewed suggestions: treat them as hypotheses to test, never as facts about the business. The ledger lists what recent posts already used; vary from it.',
  items: items.map(([type, label, summary, standing = 'approved'], i) => ({id: `node-${i + 1}`, type, label, summary, standing, confidence: standing === 'approved' ? 1 : 0.7, relations: []})),
  ledger: []});

export const BUSINESSES = [
  {
    key: 'coffee',
    name: 'Ember & Oat Coffee',
    facts: [
      fact('f-name', 'brand_name', 'Ember & Oat'),
      fact('f-offer', 'offering', 'Neighbourhood coffee bar roasting single-origin beans in small batches, with oat-milk drinks and fresh cardamom buns'),
      fact('f-aud', 'audience', 'Commuters and remote workers within walking distance who want a calm, good cup before work'),
      fact('f-voice', 'voice', 'Warm, unhurried, a little poetic'),
      fact('f-col', 'colors', '#3B2416 espresso brown, #F3E6D0 oat cream, #D9772B ember orange'),
      fact('f-type', 'brand_typography', 'Headlines: DM Serif Display, weight 400. Body: DM Sans, weight 400.'),
      fact('f-claims', 'prohibited_claims', 'No health claims, no "best coffee in town"'),
      fact('f-vd1', 'visual_direction_imagery', 'Morning window light, steam, hands around ceramic cups, warm wood and terracotta'),
      fact('f-vd2', 'visual_direction_composition', 'Editorial crops with one hero object and generous negative space'),
    ],
    moodboard: {direction: {summary: 'Slow-morning editorial warmth: amber window light on ceramics and oat-cream walls', imagery: 'Close still lifes of cups, beans and buns on warm wood; steam caught in side light; no busy crowds', voice: 'Unhurried and warm', palette: [{role: 'dominant', hex: '#F3E6D0'}, {role: 'headline', hex: '#3B2416'}, {role: 'accent', hex: '#D9772B'}], heading_font: 'DM Serif Display', body_font: 'DM Sans'}, feedback: 'Love the window light. Keep it calm, fewer props.'},
    learning: [pref('Rejection reasons mention a busy layout: 2 of 3 rejections with a reason', 2, 3)],
    knowledge: knowledge([['offer', 'Cardamom buns', 'Baked every morning at 7, sold out by 11'], ['angle', 'Ten quiet minutes', 'The cup before the commute as a small ritual'], ['persona', 'The early commuter', 'Leaves at 7:30, wants something good and quick', 'unproven']]),
    channel: 'instagram',
    static: {prompt: 'Type-led poster announcing that cardamom buns are back every morning', brief: {
      headline: 'Cardamom buns are back', body: 'Baked at seven every morning. Usually gone by eleven, so come early.', cta: 'Visit us', caption: 'They are back. Baked at seven, gone by eleven. ☕', image_prompt: 'A single cardamom bun on a speckled ceramic plate on warm oak, soft side window light, gentle steam from a cup behind, oat-cream wall, top half calm for type', palette: ['#3B2416', '#F3E6D0'], fact_ids: ['f-offer'], warnings: [],
      art_direction: art({layout_archetype: 'type_led_poster', text_mode: 'overlay', headline_treatment: 'Large DM Serif Display, sentence case, espresso brown, upper third, left aligned', hierarchy: 'Headline, bun, supporting line, logo', composition: 'Bun lower centre, top 40% clear oat-cream wall for the headline', lighting: 'Soft morning side light from the left', palette_roles: {dominant: '#F3E6D0', headline: '#3B2416', accent: '#D9772B'}, product_placement: 'The real bun from the approved product photo on a ceramic plate', logo_placement: 'bottom_right'})}},
    story: {prompt: 'Story: ten quiet minutes before work', brief: {
      headline: 'Ten quiet minutes', body: '', cta: 'Open from 7', caption: 'Your ten quiet minutes start at seven.', image_prompt: 'Vertical close view of hands around a matte ceramic cup at a sunlit window bar, steam rising, blurred street beyond the glass', palette: ['#3B2416', '#F3E6D0'], fact_ids: ['f-offer'], warnings: [],
      art_direction: art({headline_treatment: 'DM Serif Display, sentence case, oat cream, large, centred in the upper middle', hierarchy: 'Headline, cup, call to action pill, logo', composition: 'Cup lower third, window light top, clear band in the upper middle for type', lighting: 'Low amber morning sun through glass', palette_roles: {dominant: '#3B2416', headline: '#F3E6D0', accent: '#D9772B'}, product_placement: 'Ember & Oat ceramic cup with the real logo stamp as in the reference', logo_placement: 'top_left'})}},
  },
  {
    key: 'backpack',
    name: 'Northline Packs',
    facts: [
      fact('f-name', 'brand_name', 'Northline'),
      fact('f-offer', 'offering', 'Slim water-resistant city backpacks with a padded 16-inch laptop sleeve and a quick-access front pocket'),
      fact('f-aud', 'audience', 'Urban professionals who walk or cycle to work and want one bag for office and weekend'),
      fact('f-voice', 'voice', 'Calm, precise, understated'),
      fact('f-col', 'colors', '#111111 ink black, #ECE8E1 stone, #6E7F73 sage'),
      fact('f-type', 'brand_typography', 'Headlines: DM Sans, weight 600. Body: DM Sans, weight 400.'),
      fact('f-claims', 'prohibited_claims', 'Do not call the bag waterproof'),
      fact('f-vd1', 'visual_direction_imagery', 'Architectural city settings, concrete and glass, natural daylight, product as the hero'),
      fact('f-vd2', 'visual_direction_composition', 'Editorial framing with a stone border band, wordmark top left, product centred'),
    ],
    moodboard: {direction: {summary: 'Quiet architectural editorial: the bag as an object in stone-and-glass city light', imagery: 'Product on concrete ledges, long morning shadows, glass towers softly out of focus', voice: 'Precise and calm', palette: [{role: 'dominant', hex: '#ECE8E1'}, {role: 'headline', hex: '#111111'}, {role: 'accent', hex: '#6E7F73'}], heading_font: 'DM Sans', body_font: 'DM Sans'}, feedback: 'The Metro shot is exactly us.'},
    learning: [pref('Rejection reasons mention people: 2 of 2 rejections with a reason', 2, 2), pref('Approves product_hero layouts: 4 of 4 decisions', 4, 4)],
    knowledge: knowledge([['offer', 'Metro 16', 'Slim zip profile, front pocket, padded sleeve'], ['angle', 'One bag, whole day', 'Office to weekend without switching bags'], ['proof_point', 'Water-resistant fabric', 'Shrugs off a city shower; not waterproof']]),
    channel: 'instagram',
    static: {prompt: 'Lifestyle hero: carry it through the city', brief: {
      headline: 'Carry it through the city.', body: '', cta: '', caption: 'One slim bag from the first meeting to the last train.', image_prompt: 'The black Metro backpack standing on a pale concrete ledge between stone columns, glass towers softly blurred behind, long morning shadows, editorial calm', palette: ['#111111', '#ECE8E1'], fact_ids: ['f-offer'], warnings: [],
      art_direction: art({headline_treatment: 'DM Sans 600, sentence case, ink black, in the stone band below the photo, left aligned, about 9% of frame height', hierarchy: 'Product, headline, logo', composition: 'Product centred on a stone ledge, eye-level camera, stone border band framing the photo, bottom band clear for type', lighting: 'Crisp morning daylight with long soft shadows', palette_roles: {dominant: '#ECE8E1', headline: '#111111', accent: '#6E7F73'}, product_placement: 'The real Metro backpack exactly as in the approved product photo, small woven label visible', logo_placement: 'top_left'})}},
    story: {prompt: 'Story: one bag, whole day', brief: {
      headline: 'One bag. Whole day.', body: '', cta: 'Shop Metro', caption: 'From the office to the weekend.', image_prompt: 'Vertical frame of the Metro backpack on a bench in a sunlit glass atrium, city reflections, no people', palette: ['#111111', '#ECE8E1'], fact_ids: ['f-offer'], warnings: [],
      art_direction: art({headline_treatment: 'DM Sans 600, sentence case, ink black, upper middle', hierarchy: 'Headline, product, call to action, logo', composition: 'Product lower middle, clear upper band for type, story safe areas respected', lighting: 'Bright diffused atrium daylight', palette_roles: {dominant: '#ECE8E1', headline: '#111111', accent: '#6E7F73'}, product_placement: 'The real Metro backpack from the approved product photo', logo_placement: 'top_left'})}},
  },
  {
    key: 'groomer',
    name: 'Brush & Bark Grooming',
    facts: [
      fact('f-name', 'brand_name', 'Brush & Bark'),
      fact('f-offer', 'offering', 'Dog grooming studio: bath, cut, nail trim and de-shedding, by appointment, calm one-dog-at-a-time sessions'),
      fact('f-aud', 'audience', 'Dog owners in the neighbourhood with doodles, spaniels and nervous rescues'),
      fact('f-voice', 'voice', 'Cheerful, friendly, reassuring'),
      fact('f-col', 'colors', '#D7262E groom red, #8CC8EA sky blue, #FFFFFF white'),
      fact('f-type', 'brand_typography', 'Headlines: Montserrat, weight 800. Body: DM Sans, weight 400.'),
      fact('f-claims', 'prohibited_claims', 'No medical or veterinary claims'),
      fact('f-vd1', 'visual_direction_imagery', 'Bright studio interior in sky blue with red equipment and brand signage, happy fluffy dogs'),
      fact('f-vd2', 'visual_direction_composition', 'Headline designed into the scene in brand red, logo on signage'),
    ],
    moodboard: {direction: {summary: 'Bright, happy studio colour: sky-blue walls, red kit, a proud freshly groomed dog', imagery: 'Doodles on grooming tables, red dryers and shelves, signage in the scene', voice: 'Cheerful', palette: [{role: 'dominant', hex: '#8CC8EA'}, {role: 'headline', hex: '#D7262E'}, {role: 'accent', hex: '#FFFFFF'}], heading_font: 'Montserrat', body_font: 'DM Sans'}, feedback: ''},
    learning: [pref('Rejection reasons mention the wording: 2 of 3 rejections with a reason', 2, 3)],
    knowledge: knowledge([['offer', 'De-shedding treatment', 'Reduces loose undercoat for weeks'], ['angle', 'A good day for a groom', 'Grooming as a happy day out, not a chore'], ['pain', 'Nervous dogs', 'Owners worry their rescue will panic', 'unproven']]),
    channel: 'instagram',
    static: {prompt: 'Lifestyle hero: a good day for a groom', brief: {
      headline: 'A good day for a groom.', body: '', cta: 'Book now', caption: 'Fresh, fluffy and proud of it. Book a calm, one-dog session.', image_prompt: 'Bright sky-blue grooming studio, a fluffy apricot doodle standing proudly on a grooming table, red dryer and red shelves, brand signage on the wall', palette: ['#D7262E', '#8CC8EA'], fact_ids: ['f-offer'], warnings: [],
      art_direction: art({headline_treatment: 'Montserrat 800, sentence case, groom red, set on the wall as if painted signage, upper right', hierarchy: 'Dog, headline, call to action pill, logo signage', composition: 'Dog centre-left on the table, eye-level camera, wall upper right clear for the headline', lighting: 'Bright even studio light with soft window fill', palette_roles: {dominant: '#8CC8EA', headline: '#D7262E', accent: '#D7262E'}, product_placement: 'Brush & Bark signage and red studio equipment from the approved premises photo', logo_placement: 'top_right'})}},
    story: {prompt: 'Story: nervous dogs welcome', brief: {
      headline: 'Nervous dogs welcome', body: '', cta: 'Book a calm slot', caption: 'One dog at a time, no rush.', image_prompt: 'Vertical shot of a shy spaniel being gently towel-dried in a sky-blue studio, red towel, calm and friendly', palette: ['#D7262E', '#8CC8EA'], fact_ids: ['f-offer'], warnings: [],
      art_direction: art({headline_treatment: 'Montserrat 800, sentence case, groom red, upper middle', hierarchy: 'Headline, dog, call to action, logo', composition: 'Dog lower middle, clear sky-blue wall above for type', lighting: 'Soft bright studio light', palette_roles: {dominant: '#8CC8EA', headline: '#D7262E', accent: '#D7262E'}, product_placement: 'Brush & Bark studio interior and red towel', logo_placement: 'top_left'})}},
  },
].map(b => ({...b, brandId: `quality-${b.key}`, sha256: sha(b.key[0] === 'c' ? 'c' : b.key[0] === 'b' ? 'b' : 'd')}));

/** A five-slide carousel plan per business, art-directed, shaped like the carousel planner's output. */
export function carouselPlan(business) {
  const s = business.static.brief, ad = s.art_direction;
  const beats = [
    [s.headline, '', '', 'in_image'],
    ['What makes it different', `${business.facts.find(f => f.field === 'offering').value.split(',')[0]}.`, '', 'overlay'],
    ['Made for your day', 'Built around how you actually live, not a catalogue.', '', 'overlay'],
    ['Small details, done right', 'The things you notice on the hundredth day.', '', 'overlay'],
    ['Come and see', '', s.cta || 'Find us', 'in_image'],
  ];
  return {title: `${business.name}: five-slide story`, caption: s.caption, visual_direction: business.moodboard.direction.summary, palette: s.palette, warnings: [],
    art_direction: {...ad, layout_archetype: 'lifestyle_hero', text_mode: 'in_image'},
    slides: beats.map(([headline, body, cta, text_mode], i) => ({position: i + 1, headline, body, cta, image_prompt: `${s.image_prompt}. Slide ${i + 1}: ${['the hero frame', 'a close detail', 'the product in use', 'a texture macro', 'a calm closing frame'][i]}`, alt_text: `${business.name} slide ${i + 1}`, fact_ids: s.fact_ids, text_mode}))};
}

/** The three requests the "what the model sees" audit records. */
export const AUDIT_REQUESTS = [
  {id: 'lifestyle-hero-static', business: 'backpack', kind: 'static', spec: {placement: 'feed', aspect: 'portrait', slide_count: null}, references: ['logo'], stock: 'base'},
  {id: 'type-led-poster', business: 'coffee', kind: 'static', spec: {placement: 'feed', aspect: 'square', slide_count: null}, references: ['product'], stock: null},
  {id: 'carousel-5', business: 'groomer', kind: 'carousel', spec: {placement: 'feed', aspect: 'portrait', slide_count: 5}, references: ['premises', 'logo'], stock: null},
];

export const business = key => {
  const found = BUSINESSES.find(b => b.key === key);
  if (!found) throw new Error(`Unknown business ${key}`);
  return found;
};
