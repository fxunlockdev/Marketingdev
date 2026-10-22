import {validatePlanningResult,type PlanningInput,type PlanningResult} from "./planning-contracts.js";
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
export class SkillRuntime {
  constructor(readonly image?: string) {}
  get configured() {
    return !!this.image && /^sha256:[a-f0-9]{64}$/.test(this.image);
  }
  plan(input:CreativeInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<SkillResult> {
    return this.run(input,model,value=>validateSkillResult(value,input));
  }
  contentPlan(input:PlanningInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>):Promise<PlanningResult> {
    return this.run(input,model,value=>validatePlanningResult(value,input));
  }
  private async run<T>(input:CreativeInput|PlanningInput,model:(request:PlannerRequest)=>Promise<PlannerResponse>,validate:(value:any)=>T):Promise<T> {
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
          250000,
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
              void model(value)
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
