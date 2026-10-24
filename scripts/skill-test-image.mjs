import {runtimeArchitecture,assertRuntimeArchitecture,pythonRuntimeImage} from './runtime-architecture.mjs';
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
// Explicitly stage an allowlisted context. Legacy Docker builders ignore
// Dockerfile-specific ignore files; never send the checkout, credentials or node_modules.
export function prepareSkillImage() {
  const architecture=runtimeArchitecture(),tag=`desvio-skills:${architecture}`;
  const context = mkdtempSync(join(tmpdir(), "desvio-skill-build-"));
  try {
    for (const relative of [
      "apps/skills/Dockerfile",
      "apps/skills/requirements.lock",
      "apps/skills/runtime.py",
      "scripts/brand_engine_audit.py",
      "inputs/brand-engine-gpt-2k.zip",
      "scripts/skill_audit.py",
      "inputs/marketingskills-main.zip",
    ]) {
      const target = join(context, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, relative), target);
    }
    execFileSync(
      "docker",
      [
        "build", "--platform", `linux/${architecture}`, "--build-arg", `BASE_IMAGE=${pythonRuntimeImage(architecture)}`,
        "-q",
        "-t",
        tag,
        "-f",
        join(context, "apps/skills/Dockerfile"),
        context,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 1800000 },
    );
    const image = execFileSync(
      "docker",
      ["image", "inspect", tag, "--format", "{{.Id}}"],
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error("Skill image digest missing");
    console.log(
      `Actual isolated Deep Agents skill runtime ${image}; no network or credentials`,
    );
    assertRuntimeArchitecture(image,architecture);
    return image;
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}
