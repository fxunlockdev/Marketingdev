import {publishedMedia} from '../../../lib/published-media.mjs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,context:Context){return publishedMedia(request,(await context.params).path);}
export const HEAD=GET;
