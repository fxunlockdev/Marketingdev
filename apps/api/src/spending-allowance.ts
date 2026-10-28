/** Only an explicit database NULL is uncapped. Missing/invalid caps fail closed.
 * Reservations remain recorded even when no lifetime ceiling is configured. */
export function exceedsAllowance(total:number,budget:unknown):boolean {
 if(!Number.isSafeInteger(total)||total<0)return true;
 if(budget===null)return false;
 if(typeof budget!=="number"&&typeof budget!=="string")return true;
 if(typeof budget==="string"&&!/^[1-9][0-9]*$/.test(budget))return true;
 const cap=Number(budget);
 return !Number.isSafeInteger(cap)||cap<=0||total>cap;
}

/** Only our exact database budget exception is safe to expose as a known denial. */
export function monthlyBudgetExceeded(error:unknown):boolean {
 return typeof error==='object'&&error!==null&&'code' in error&&error.code==='P0001'&&'message' in error&&error.message==='MONTHLY_GENERATION_BUDGET_EXHAUSTED';
}
