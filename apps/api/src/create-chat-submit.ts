/** Never dispatch a possibly paid operation until its exact recovery envelope is durable. */
export async function dispatchSavedCreation<T,R>(snapshot:T,save:(snapshot:T)=>Promise<unknown>,send:(snapshot:T)=>Promise<R>):Promise<R>{
 await save(snapshot);
 return send(snapshot);
}
