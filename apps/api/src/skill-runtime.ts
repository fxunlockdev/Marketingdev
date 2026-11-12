import type {PromptKnowledge} from './knowledge-production.js';
import {planningSchema} from './planning-schema.js';
import {hasCurrentProductionRules} from './production-skill-pin.js';
import {carouselPlanSchema,validateCarouselInput,validateCarouselResult,type CarouselInput,type CarouselResult} from './carousel-planning.js';
import {validateInsightResult,type InsightInput} from './insight-contracts.js';
import {strategySchema,validateStrategyInput,validateStrategyResult,type StrategyInput,type StrategyResult} from './strategy-contracts.js';
import {scheduleGeneratedPlan,validatePlanningResult,type PlanningInput,type PlanningResult} from "./planning-contracts.js";
import {normalizeGeneratedVideoBrief,validateVideoInput,validateVideoPlanningResult,type VideoPlanningInput,type VideoPlanningResult} from './video-planning.js';
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  CreativeError,
  validateSkillResult,
  type CreativeInput,
  type PlannerRequest,
  type PlannerResponse,
  type SkillResult,
} from "./creative-contracts.js";
/** Adds a stored knowledge pack to the brand block the sandbox reads; the sandbox accepts any brand object. */
function withKnowledge<T extends {brand:object}>(input:T,knowledge?:PromptKnowledge):T{
  return knowledge?{...input,brand:{...input.brand,knowledge}}:input;
}
/** Brand Engine recipe files every fresh image or carousel brief must have loaded (preloaded by the sandbox). */
export const BRAND_ENGINE_RECIPES=['/skills/brand-engine/references/design-recipes.md','/skills/brand-engine/references/asset-recipes.md'] as const;
/** Sandbox wall clock (runtime.py RUN_SECONDS) plus container start-up, under the 6-minute planning activity. */
export const SKILL_RUN_TIMEOUT_MS=340000;
export type SkillTask='creative'|'carousel'|'content_plan'|'video'|'performance_analysis'|'strategy'|'blog';
export function skillTask(input:unknown):SkillTask{
  const task=(input as {task?:unknown})?.task;
  return typeof task==='string'?task as SkillTask:'creative';
}
/** True unless an image task's fresh result lacks the Brand Engine recipes in its reads manifest. */
export function hasBrandEngineRecipes(value:unknown,task:SkillTask):boolean{
  if(task!=='creative'&&task!=='carousel')return true;
  const reads=(value as {reads?:unknown})?.reads;
  return Array.isArray(reads)&&BRAND_ENGINE_RECIPES.every(path=>reads.includes(path));
}
export class SkillRuntime {
  constructor(readonly image?: string) {}
  get configured() {
    return !!this.image && /^sha256:[a-f0-9]{64}$/.test(this.image);
  }
  plan(input:CreativeInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<SkillResult> {
    return this.run(input,request=>model({...request,creative_fact_ids:input.brand.facts.map(f=>f.id)}),value=>validateSkillResult(value,input));
  }
  contentPlan(input:PlanningInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<PlanningResult> {
    // Daily placement limits belong to the application, not the isolated model input.
    const {max_posts_per_day,post_ideas,...providerInput}=input;
    return this.run(providerInput,request=>model({...request,content_plan_schema:planningSchema(input)}),value=>validatePlanningResult({...value,plan:scheduleGeneratedPlan(value.plan,input)},input));
  }
  /** Brand strategy. The strict JSON schema travels in the planner-schema slot of the broker request. */
  strategy(input:StrategyInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<StrategyResult> {
    validateStrategyInput(input);
    // run() accepts any task payload at runtime; its input union is owned by the other task methods.
    return this.run(input as unknown as PlanningInput,request=>model({...request,content_plan_schema:strategySchema(input)}),value=>validateStrategyResult(value,input));
  }
  /** `knowledge`, when given, is the stored context pack. It reaches the sandbox as brand.knowledge only; the
   * validated input, the schema and the result check stay those of the stored request. */
  videoPlan(input:VideoPlanningInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>,knowledge?:PromptKnowledge):Promise<VideoPlanningResult> {
    validateVideoInput(input);
    return this.run(withKnowledge(input,knowledge),request=>model({...request,video_plan:{fact_ids:input.brand.facts.map(f=>f.id),duration_seconds:input.duration_seconds}}),value=>validateVideoPlanningResult({...value,brief:normalizeGeneratedVideoBrief(value.brief,input)},input));
  }
  insights(input:InsightInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<any>{return this.run(input,model,value=>validateInsightResult(value,input));}
  carouselPlan(input:CarouselInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>,knowledge?:PromptKnowledge):Promise<CarouselResult>{validateCarouselInput(input);return this.run(withKnowledge(input,knowledge),request=>model({...request,carousel_plan_schema:carouselPlanSchema(input)}),value=>validateCarouselResult(value,input));}
  private async run<T>(input:CreativeInput|PlanningInput|VideoPlanningInput|InsightInput|CarouselInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>,validate:(value:any)=>T):Promise<T> {
    if (!this.configured)
      throw new CreativeError("SKILL_RUNTIME_NOT_CONFIGURED");
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded) > 390000)
      throw new CreativeError("SKILL_INPUT_LIMIT");
    const name = `desvio-skills-${randomUUID()}`;
    try {
      return await new Promise((resolve, reject) => {
        let line = "",
          total = 0,
          step = 0,
          pending = false,
          settled = false;
        const child = spawn(
          "docker",
          [
            "run",
            "--rm",
            "-i",
            "--name",
            name,
            "--label",
            "desvio.purpose=skill-sandbox",
            "--network",
            "none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "64",
            "--memory",
            "1g",
            "--cpus",
            "1",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            this.image!,
          ],
          { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH } },
        );
        const done = (error?: Error, result?: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.stdin.destroy();
          if (error) {
            child.kill("SIGKILL");
            reject(error);
          } else resolve(result!);
        };
        const timer = setTimeout(
          () => done(new CreativeError("SKILL_RUNTIME_TIMEOUT")),
          SKILL_RUN_TIMEOUT_MS,
        );
        child.on("error", () =>
          done(new CreativeError("SKILL_RUNTIME_UNAVAILABLE")),
        );
        child.stderr.resume();
        child.stdin.on("error", () => {});
        child.stdout.on("data", (data: Buffer) => {
          total += data.length;
          if (total > 2_000_000)
            return done(new CreativeError("SKILL_OUTPUT_LIMIT"));
          line += data.toString("utf8");
          let newline;
          while ((newline = line.indexOf("\n")) >= 0) {
            const raw = line.slice(0, newline);
            line = line.slice(newline + 1);
            if (settled) break;
            let value: any;
            try {
              value = JSON.parse(raw);
            } catch {
              return done(new CreativeError("SKILL_OUTPUT_INVALID"));
            }
            if (value.type === "model") {
              if (
                pending ||
                value.step !== ++step ||
                step > 3 ||
                raw.length > 500000 ||
                !Array.isArray(value.messages) ||
                !Array.isArray(value.tools)
              )
                return done(new CreativeError("SKILL_BROKER_INVALID"));
              pending = true;
              void model({...value,chat_response:undefined,video_plan:undefined,content_plan_schema:undefined,carousel_plan_schema:undefined,creative_fact_ids:undefined,images:undefined})
                .then((result) => {
                  pending = false;
                  if (!settled)
                    child.stdin.write(JSON.stringify(result) + "\n");
                })
                .catch((error) =>
                  done(
                    error instanceof Error
                      ? error
                      : new CreativeError("SKILL_BROKER_FAILED"),
                  ),
                );
            } else if (value.type === "result") {
              if (pending || value.model_calls !== step)
                return done(new CreativeError("SKILL_BROKER_INVALID"));
              try {
                if (!hasCurrentProductionRules(value)||!hasBrandEngineRecipes(value,skillTask(input))) throw new CreativeError("SKILL_LOAD_INCOMPLETE");
                done(undefined, validate(value));
              } catch (error) {
                done(error as Error);
              }
            } else if (value.type === "error")
              done(
                new CreativeError(
                  /^SKILL_[A-Z_]+$/.test(value.code)
                    ? value.code
                    : "SKILL_RUNTIME_FAILED",
                ),
              );
            else done(new CreativeError("SKILL_BROKER_INVALID"));
          }
        });
        child.on("exit", () => {
          if (!settled) done(new CreativeError("SKILL_RUNTIME_FAILED"));
        });
        // Keep stdin open for the bounded model broker replies.
        child.stdin.write(encoded + "\n");
      });
    } finally {
      await promisify(execFile)("docker", ["rm", "-f", name], {
        timeout: 10000,
      }).catch(() => {});
    }
  }
}
