/** Settling a paid text call at its reported cost.
 *
 * Every provider call reserves a worst-case amount before it is sent. When the call succeeds and
 * the provider reports token usage, the ledger row also records what the call actually cost, and
 * budgets count that instead of the reservation. A call without a trustworthy usage report keeps
 * its full reservation: null here means "do not settle".
 *
 * Cached input is charged at the full input rate, the amount is rounded up, and it never exceeds
 * the reservation, which stays the safety bound.
 */
export type TokenRates={readonly input_micros_per_token:unknown;readonly output_micros_per_token:unknown};

/** What a budget query sums for one ledger row. */
export const CHARGED_MICROS='COALESCE(settled_micros,reserved_micros)';

/** Rates are compared to a millionth of a micro so float noise never rounds a whole micro up. */
const PRECISION=1e6;

function tokenCount(value:unknown):number|null{
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
}
function rate(value:unknown):number|null{
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='string'&&!/^[0-9]+(\.[0-9]+)?$/.test(value))return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>=0?n:null;
}
function reservation(value:unknown):number|null{
 if(typeof value==='string'&&!/^[1-9][0-9]*$/.test(value))return null;
 const n=typeof value==='string'?Number(value):value;
 return typeof n==='number'&&Number.isSafeInteger(n)&&n>0?n:null;
}

/** Provider token usage in the Responses API shape, or null when it is missing or malformed. */
export function reportedTokens(usage:unknown):{input:number;output:number}|null{
 if(typeof usage!=='object'||usage===null||Array.isArray(usage))return null;
 const report=usage as {input_tokens?:unknown;output_tokens?:unknown};
 const input=tokenCount(report.input_tokens),output=tokenCount(report.output_tokens);
 return input===null||output===null?null:{input,output};
}

/** Actual cost in micros of a call that reported `usage`, capped at `reservedMicros`.
 * `fixedMicros` is a per-call allowance the reservation already priced, such as hosted tool calls. */
export function settledMicros(usage:unknown,rates:TokenRates|null|undefined,reservedMicros:unknown,fixedMicros:number=0):number|null{
 const tokens=reportedTokens(usage),reserved=reservation(reservedMicros);
 if(!tokens||reserved===null||!rates)return null;
 const input=rate(rates.input_micros_per_token),output=rate(rates.output_micros_per_token);
 if(input===null||output===null||!Number.isSafeInteger(fixedMicros)||fixedMicros<0)return null;
 const exact=tokens.input*input+tokens.output*output+fixedMicros;
 if(!Number.isFinite(exact))return null;
 return Math.min(reserved,Math.ceil(Math.round(exact*PRECISION)/PRECISION));
}
