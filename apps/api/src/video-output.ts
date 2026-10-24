// Worker-local provenance. Mint only after scoped permission checks and opening
// the authenticated provider result from VideoVault. Never accept this from HTTP,
// model/skill output, request JSON or a customer-supplied download URL.
export type AuthenticatedVideoOutput = Readonly<{url:string}>;
const authenticated = new WeakSet<object>();
export function authenticatedVideoOutput(url:string):AuthenticatedVideoOutput {
 if(typeof url!=='string'||!url)throw new Error('VIDEO_OUTPUT_INVALID');
 const output=Object.freeze({url});authenticated.add(output);return output;
}
export function isAuthenticatedVideoOutput(value:unknown):value is AuthenticatedVideoOutput {
 return typeof value==='object'&&value!==null&&authenticated.has(value);
}
