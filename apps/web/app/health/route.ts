export const dynamic='force-dynamic';
export function GET(){return Response.json({status:'ok',scope:'web-process-only'},{headers:{'cache-control':'no-store'}});}
