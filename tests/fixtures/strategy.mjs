const LEVELS=['unaware','problem_aware','solution_aware','product_aware','most_aware'];
/** A valid brand strategy for a strategy input. Every string is a labelled test fixture. */
export function generatedStrategy(input){
 const fact=input.brand.facts[0].id,evidence=input.evidence?.[0]?.id,cite=i=>i%2===0?{fact_ids:[fact],evidence_ids:evidence?[evidence]:[],basis:'proven'}:{fact_ids:[],evidence_ids:[],basis:'unproven'};
 const personas=[1,2,3].map(n=>({id:`persona_${n}`,name:`TEST Careful Busy Owner ${n}`,life_situation:`TEST situation ${n}`,relationship_to_problem:`TEST tried and fears ${n}`,why_this_brand:`TEST reason ${n}`,...cite(n-1)}));
 const pains=personas.flatMap((p,i)=>[1,2].map(n=>({id:`pain_${i*2+n}`,persona_id:p.id,statement:`TEST pain ${n} of ${p.id}`,anchor:n===1,...cite(n)})));
 const angles=personas.flatMap((p,i)=>[0,1].map(n=>({id:`angle_${i*2+n+1}`,persona_id:p.id,pain_id:`pain_${i*2+1}`,awareness:LEVELS[n+1],angle:`TEST angle ${n+1} for ${p.id}`,...cite(n)})));
 const formats=angles.map((a,i)=>({id:`format_${i+1}`,angle_id:a.id,format:['static','carousel','story','reel'][i%4],rationale:`TEST why this format ${i+1}`}));
 const pillars=[1,2,3].map(n=>({id:`pillar_${n}`,name:`TEST pillar ${n}`,purpose:`TEST purpose ${n}`,persona_ids:[`persona_${n}`],...cite(n-1)}));
 return {summary:'TEST FIXTURE: strategy summary.',personas,pains,angles,formats,pillars,warnings:['TEST FIXTURE: no customer quotes supplied.']};
}
