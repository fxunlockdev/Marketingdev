/** Safe diagnostic logging for worker activities.
 * Activities replace failures with a generic retryable error so nothing sensitive reaches
 * Temporal history. This records the real cause on stderr instead, with credentials removed.
 */
export type ActivityScope={jobId:string;organizationId?:string;brandId?:string};
export type FailureEntry={event:'activity_failed';activity:string;job_id:string;organization_id:string|null;brand_id:string|null;error_name:string;error_code:string|null;message:string;stack:string[]};

const MAX_MESSAGE=500,MAX_FRAMES=6,MAX_FRAME=300;
const SECRET_PATTERNS:[RegExp,string][]=[
 // Connection strings: keep the scheme and host, drop the user and password.
 [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi,'$1[redacted]@'],
 [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,'$1 [redacted]'],
 [/\b(sk|rk|pk|key)[-_][A-Za-z0-9_-]{16,}/g,'[redacted]'],
 [/\b((?:api[-_]?key|secret|token|password|authorization|signature)["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi,'$1[redacted]'],
 [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,'[redacted]'],
];

export function redact(value:string):string{
 return SECRET_PATTERNS.reduce((text,[pattern,replacement])=>text.replace(pattern,replacement),value);
}

function clean(value:string,limit:number):string{
 const text=redact(value.replace(/[\r\n\t]+/g,' ')).trim();
 return text.length>limit?text.slice(0,limit-1)+'…':text;
}

export function describeFailure(activity:string,scope:ActivityScope,error:unknown):FailureEntry{
 const known=error instanceof Error;
 const rawCode:unknown=known?(error as Error&{code?:unknown}).code:undefined;
 const code=typeof rawCode==='string'?clean(rawCode,80):null;
 const frames=known&&typeof error.stack==='string'?error.stack.split('\n').slice(1,1+MAX_FRAMES).map(frame=>clean(frame,MAX_FRAME)).filter(Boolean):[];
 return {
  event:'activity_failed',activity,job_id:scope.jobId,
  organization_id:scope.organizationId??null,brand_id:scope.brandId??null,
  error_name:known?error.name:'NonError',error_code:code,
  message:clean(known?error.message:String(error),MAX_MESSAGE),
  stack:frames,
 };
}

/** Never throws: a logging fault must not change how the activity fails. */
export function logActivityFailure(activity:string,scope:ActivityScope,error:unknown,write:(line:string)=>void=line=>{process.stderr.write(line+'\n');}):void{
 try{write(JSON.stringify(describeFailure(activity,scope,error)));}catch{/* diagnostics only */}
}
