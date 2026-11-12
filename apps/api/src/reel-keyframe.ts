import {creativeSourceSize,type CreativeSpec} from './campaign-formats.js';

/** A starting frame for a video, made by the normal image engine (art direction, mood board, context pack,
 * stock when useful, vision QA) at the video's own aspect, then approved and exported at full size. Pure. */
export type KeyframeAspect='square'|'portrait'|'landscape'|'vertical';
export type KeyframeRequest={prompt:string;format:'static';channel:string;size:'1024x1024'|'1024x1536'|'1536x1024';creative_spec?:CreativeSpec};
export type GeneratedVideoReference={export_id:string;approval_id:string;source_sha256:string;export_sha256:string};
type ExportState={renderer_image:string;exports:{id:string;format:string;renderer_image:string;source_sha256:string;sha256:string;version_id?:string}[];approvals:{id:string;export_id:string;context_type:string;context_id:string}[]};

export const KEYFRAME_PROMPT_LIMIT=4000;
const KEYFRAME_DIRECTION='Create the opening frame of a short video: one photographic still the camera can move through, with a clear subject, depth and room for motion. Show no words, letters, numbers or captions anywhere in the picture; the video adds its own text later.';

/** The image request for a starting frame, composed at the video's own shape: 1:1, 16:9, a true 4:5 portrait
 * (1024x1280) and a true 9:16 story frame (1080x1920), so the video provider receives exactly the approved frame
 * at the aspect it animates. LinkedIn has no story placement, so its tall frame stays the provider's 2:3. */
export function keyframeRequest(input:{prompt:string;channel:string;aspect:KeyframeAspect}):KeyframeRequest{
 const brief=input.prompt.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').trim();
 if(!brief)throw new Error('Describe the video before creating its starting frame');
 const prompt=`${KEYFRAME_DIRECTION}\nVideo brief: ${brief}`;
 if(prompt.length>KEYFRAME_PROMPT_LIMIT)throw new Error('Shorten the video brief to create a starting frame');
 const creative_spec=keyframeSpec(input.aspect,input.channel);
 return creative_spec?{prompt,format:'static',channel:input.channel,size:creativeSourceSize(creative_spec),creative_spec}:{prompt,format:'static',channel:input.channel,size:'1024x1536'};
}
function keyframeSpec(aspect:KeyframeAspect,channel:string):CreativeSpec|null{
 if(aspect!=='vertical')return {placement:'feed',aspect,slide_count:null};
 return channel==='linkedin'?null:{placement:'story',aspect:'vertical',slide_count:null};
}
/** Video aspect for a Create-chat size or placement. */
export function keyframeAspect(placement:string|undefined,size:string|undefined):KeyframeAspect{
 if(placement&&placement!=='feed')return 'vertical';
 return size==='1024x1024'?'square':size==='1536x1024'?'landscape':size==='1024x1536'?'portrait':'vertical';
}
/** The approved full-size PNG export of this frame, as a video reference; null until it exists and is approved. */
export function keyframeReference(state:ExportState,versionId:string):GeneratedVideoReference|null{
 const saved=state.exports.find(e=>e.format==='png'&&e.renderer_image===state.renderer_image&&(e.version_id===undefined||e.version_id===versionId));
 const approval=saved&&state.approvals.find(a=>a.export_id===saved.id&&a.context_type==='canvas'&&a.context_id===versionId);
 return saved&&approval?{export_id:saved.id,approval_id:approval.id,source_sha256:saved.source_sha256,export_sha256:saved.sha256}:null;
}
