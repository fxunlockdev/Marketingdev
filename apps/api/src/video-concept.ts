import {CreativeError} from './creative-contracts.js';
function fields(value:any,keys:string[]) {return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');}
function plain(v:any,max:number) {return typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);}
export type VideoConcept={storyline:string;script:string;prompt:string;duration_seconds:number};
export function validateVideoConcept(value:any):VideoConcept {
 if(!fields(value,['storyline','script','prompt','duration_seconds'])||!plain(value.storyline,600)||!plain(value.script,1200)||!plain(value.prompt,1200)||!Number.isInteger(value.duration_seconds)||value.duration_seconds<3||value.duration_seconds>15)throw new CreativeError('PLAN_VIDEO_INVALID');
 return value;
}
