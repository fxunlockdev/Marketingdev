/** How an intake job ends once its retries are exhausted.
 * "unknown" blocks further requests of that kind until someone reviews it, so it is
 * reserved for the one case that needs review: a paid provider call whose result is
 * uncertain. A failure before any call, or after a settled call, is safe to retry.
 */
export type AnalysisCallStatus='submitted'|'unknown'|'succeeded'|'rejected'|null;
export type IntakeOutcome={status:'failed'|'unknown';code:string};

export function exhaustedIntakeOutcome(kind:string,call:AnalysisCallStatus):IntakeOutcome{
 if(kind==='website.extract')return {status:'failed',code:'WEBSITE_RETRIES_EXHAUSTED'};
 if(kind!=='brand.analyze')throw new Error('JOB_KIND_DENIED');
 if(call==='submitted'||call==='unknown')return {status:'unknown',code:'AI_SUBMISSION_REQUIRES_REVIEW'};
 if(call==='rejected')return {status:'failed',code:'AI_ANALYSIS_FAILED_AFTER_REJECTION'};
 if(call==='succeeded')return {status:'failed',code:'AI_ANALYSIS_RESULT_NOT_SAVED'};
 return {status:'failed',code:'AI_ANALYSIS_FAILED_BEFORE_SUBMISSION'};
}
