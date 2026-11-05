/** Aggregate only completed jobs already scoped to the current business. */
export function generationTimingEstimate(samples:unknown[],media:'image'|'video'){
 const times=samples.filter(v=>typeof v==='number'||typeof v==='string'&&v.trim()!=='').map(Number).filter(n=>Number.isFinite(n)&&n>=1&&n<=7200).sort((a,b)=>a-b);
 if(times.length<3)return null;
 const step=media==='video'?60:30;
 return {min_seconds:Math.max(step,Math.floor(times[Math.floor((times.length-1)*.25)]/step)*step),max_seconds:Math.max(step,Math.ceil(times[Math.ceil((times.length-1)*.9)]/step)*step),sample_count:times.length,source:'recent_generations'};
}
