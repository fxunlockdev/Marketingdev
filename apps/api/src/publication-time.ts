/** Publishing times are chosen as wall-clock times in the business's time zone and stored as instants. */
export const PUBLISH_MIN_LEAD_MS=60000;
export const PUBLISH_MAX_AHEAD_MS=31*86400000;

function offsetMs(at:number,zone:string):number{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second))-Math.floor(at/1000)*1000;
}
/** "2027-01-02T09:30" in `zone` as an instant. Returns null for malformed input, an unknown zone, or a wall time the zone skips. */
export function zonedInstant(local:unknown,zone:string):Date|null{
 if(typeof local!=='string')return null;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);if(!m)return null;
 const [y,mo,d,h,mi]=m.slice(1).map(Number),wall=Date.UTC(y,mo-1,d,h,mi);
 const check=new Date(wall);if(check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d||h>23||mi>59)return null;
 try{
  let at=wall-offsetMs(wall,zone);at=wall-offsetMs(at,zone);
  return at+offsetMs(at,zone)===wall?new Date(at):null;
 }catch{return null;}
}
/** True when `at` is at least a minute ahead and no more than 31 days ahead of `now`. */
export function inPublishWindow(at:Date|number,now:number=Date.now()):boolean{
 const t=typeof at==='number'?at:at.getTime();return Number.isFinite(t)&&t>=now+PUBLISH_MIN_LEAD_MS&&t<=now+PUBLISH_MAX_AHEAD_MS;
}
