/** What produced a published post: read defensively from the slot, the creative version and its brief. Unknown stays null. */
export type Attribution={creative_version_id:string|null;format:string;channel:string|null;pillar:string|null;hook:string|null;cta:string|null;layout_archetype:string|null;stock_used:boolean|null;posted_weekday:string|null;posted_hour:number|null;timezone:string|null};
export const ATTRIBUTION_DIMENSIONS=['format','channel','pillar','hook','cta','layout_archetype','stock_used','posted_weekday','posted_hour'] as const;
export type AttributionDimension=typeof ATTRIBUTION_DIMENSIONS[number];
export type AttributionSource={version_id?:unknown;channel?:unknown;pillar?:unknown;hook?:unknown;cta?:unknown;timezone?:unknown;creative_spec?:unknown;brief?:unknown;design?:unknown;manifest_references?:unknown;imported_stock?:unknown;has_creative_version?:unknown};

/** Joins that carry attribution for a published post: slot and plan, then the published creative version, its media and its generation brief. */
export const attributionColumnsSQL="s.channel,s.pillar,s.hook,s.cta,s.creative_spec,pl.timezone,COALESCE(CASE WHEN p.proof->>'version_id' ~ '^[0-9a-fA-F-]{36}$' THEN p.proof->>'version_id' END,s.carousel_version_id::text,s.video_version_id::text,s.creative_version_id::text) AS version_id,v.id IS NOT NULL AS has_creative_version,v.design,v.skill_manifest->'references' AS manifest_references,m.source_uploaded_visual_id IS NOT NULL AS imported_stock,r.plan->'brief' AS brief";
export const attributionJoinsSQL="JOIN app.content_plans pl ON pl.id=s.plan_id LEFT JOIN app.creative_versions v ON s.carousel_version_id IS NULL AND s.video_version_id IS NULL AND v.id=COALESCE(CASE WHEN p.proof->>'version_id' ~ '^[0-9a-fA-F-]{36}$' THEN (p.proof->>'version_id')::uuid END,s.creative_version_id) LEFT JOIN app.creative_media m ON m.id=v.media_id LEFT JOIN app.creative_requests r ON r.job_id=v.job_id";

const WEEKDAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const label=(value:unknown,max:number):string|null=>{if(typeof value!=='string')return null;const text=value.replace(/[\u0000-\u001f\u007f]/g,' ').trim();return text?text.slice(0,max):null;};
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Weekday and hour (0-23) in the business timezone; null when the time or zone is unusable. */
export function postedLocal(at:unknown,timezone:unknown):{weekday:string;hour:number}|null{
 const time=at instanceof Date?at.getTime():typeof at==='string'?Date.parse(at):NaN;if(!Number.isFinite(time)||typeof timezone!=='string'||!timezone)return null;
 try{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'long',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time));
  const weekday=parts.find(p=>p.type==='weekday')?.value,hour=Number(parts.find(p=>p.type==='hour')?.value);
  return weekday&&WEEKDAYS.includes(weekday)&&Number.isInteger(hour)&&hour>=0&&hour<=23?{weekday,hour}:null;
 }catch{return null;}
}
/** The brief's art direction is being added by another change; accept the likely locations and nothing else. */
export function layoutArchetype(...sources:unknown[]):string|null{
 for(const source of sources){
  const top=record(source);if(!top)continue;const art=record(top.art_direction);
  for(const candidate of [art?.layout_archetype,art?.layout,top.layout_archetype]){const found=label(candidate,80);if(found)return found;}
 }
 return null;
}
/** True when the version records a stock reference or imported stock photo; false only when a creative version exists without one. */
export function stockUsed(source:AttributionSource):boolean|null{
 if(source.imported_stock===true)return true;
 const references=Array.isArray(source.manifest_references)?source.manifest_references:[];
 if(references.some(r=>{const kind=record(r)?.kind;return typeof kind==='string'&&kind.startsWith('stock');}))return true;
 return source.has_creative_version===true?false:null;
}
export function attribution(source:AttributionSource,format:string,postedAt:unknown):Attribution{
 const local=postedLocal(postedAt,source.timezone);
 return {creative_version_id:typeof source.version_id==='string'&&/^[0-9a-f-]{36}$/i.test(source.version_id)?source.version_id.toLowerCase():null,format,channel:label(source.channel,40),pillar:label(source.pillar,140),hook:label(source.hook,500),cta:label(source.cta,500),
  layout_archetype:layoutArchetype(source.brief,source.creative_spec,source.design),stock_used:stockUsed(source),posted_weekday:local?.weekday??null,posted_hour:local?.hour??null,timezone:local?String(source.timezone):null};
}
/** The value an insight must quote to reference a dimension; null means the dimension is unknown for that post. */
export function attributionValue(a:unknown,dimension:AttributionDimension):string|null{const value=record(a)?.[dimension];return value===null||value===undefined?null:String(value);}
