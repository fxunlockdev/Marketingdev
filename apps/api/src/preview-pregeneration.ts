import {logActivityFailure,type ActivityScope} from './activity-log.js';
import type {ImagePreviews} from './image-previews.js';
import type {PreviewWidth} from './media-variants.js';

/** Store every display width of an original that was just persisted, while its bytes are in memory.
 * Optional work: a failure is logged and the producing job or request carries on. Returns the widths written. */
export async function pregeneratePreviews(previews:Pick<ImagePreviews,'pregenerate'>,scope:ActivityScope,key:string,sha256:string,bytes:Buffer,write?:(line:string)=>void):Promise<PreviewWidth[]>{
 try{return await previews.pregenerate(key,sha256,bytes);}
 catch(error){logActivityFailure('PreviewPregeneration',scope,error,write);return [];}
}
