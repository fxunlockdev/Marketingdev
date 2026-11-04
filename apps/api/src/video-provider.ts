/** Server-only provider port. Paid submissions are never automatically replayed. */
export class VideoProviderError extends Error {
 constructor(readonly code:string,readonly outcome:'not_sent'|'rejected'|'unknown'='not_sent',readonly retryAfterSeconds?:number){super(code);this.name='VideoProviderError';}
}
export type VideoProvider = {
 readonly providerName?:string;
 prepare(intent:any):{model:string;idempotencyKey:string;sha256:string};
 withBudget?(intent:any,maxMicros:number):any;
 submit(intent:any,sha:string):Promise<{requestId:string;routing?:Record<string,unknown>}>;
 status(id:string):Promise<{state:string;videoURL:string|null;errorCode:string|null;progress?:number}>;
 cancel(id:string):Promise<unknown>;
};
