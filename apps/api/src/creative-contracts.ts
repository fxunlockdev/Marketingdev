import { CREATIVE_SKILLS } from "./creative-skill-pins.js";
export class CreativeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export type CreativeBrief = {
  headline: string;
  body: string;
  cta: string;
  caption: string;
  image_prompt: string;
  palette: string[];
  fact_ids: string[];
  warnings: string[];
};
export type CreativeInput = {
  brand: {
    id: string;
    sha256: string;
    facts: { id: string; field: string; value: string }[];
  };
  prompt: string;
  format: "static" | "ad";
  channel: "linkedin" | "instagram";
  parent: null | {
    caption: string;
    headline: string;
    body: string;
    cta: string;
  };
};
export type ProviderContext={provider:'gemini';parts:unknown[]};
export type PlannerMessage = {
  provider_context?:ProviderContext;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
  tool_call_id?: string;
};
export type PlannerRequest = {
  type: "model";
  step: number;
  messages: PlannerMessage[];
  tools: any[];
};
export type PlannerResponse = {
  provider_context?:ProviderContext;
  content: string;
  tool_calls: { id: string; name: string; args: Record<string, unknown> }[];
  response_id?: string;
  usage?: unknown;
};
export type SkillResult = {
  type: "result";
  version: string;
  brief: CreativeBrief;
  skills: { name: string; skill_sha256: string; tree_sha256: string }[];
  reads: string[];
  model_calls: number;
  helpers_executed: false;
};
export const selectedSkills = (format: CreativeInput["format"]) =>
  [
    "image",
    "product-marketing",
    "social",
    ...(format === "ad" ? ["ad-creative"] : []),
  ].sort();
export function validateBrief(
  value: unknown,
  input: CreativeInput,
): CreativeBrief {
  const b = value as any,
    limits = {
      headline: 140,
      body: 500,
      cta: 80,
      caption: 3000,
      image_prompt: 8000,
    };
  if (
    !b ||
    typeof b !== "object" ||
    Object.keys(b).sort().join(",") !==
      [
        "headline",
        "body",
        "cta",
        "caption",
        "image_prompt",
        "palette",
        "fact_ids",
        "warnings",
      ]
        .sort()
        .join(",")
  )
    throw new CreativeError("CREATIVE_BRIEF_INVALID");
  for (const [key, max] of Object.entries(limits))
    if (
      typeof b[key] !== "string" ||
      b[key].length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(b[key])
    )
      throw new CreativeError("CREATIVE_BRIEF_INVALID");
  if (
    !b.image_prompt.trim() ||
    !b.caption.trim() ||
    !Array.isArray(b.palette) ||
    b.palette.length !== 2 ||
    b.palette.some(
      (c: any) => typeof c !== "string" || !/^#[\da-f]{6}$/i.test(c),
    ) ||
    !Array.isArray(b.fact_ids) ||
    !b.fact_ids.length ||
    b.fact_ids.length > 20 ||
    new Set(b.fact_ids).size !== b.fact_ids.length ||
    b.fact_ids.some((id: any) => !input.brand.facts.some((f) => f.id === id)) ||
    !Array.isArray(b.warnings) ||
    b.warnings.length > 10 ||
    b.warnings.some((w: any) => typeof w !== "string" || w.length > 500)
  )
    throw new CreativeError("CREATIVE_BRIEF_INVALID");
  return b;
}
export function validateSkillResult(
  value: any,
  input: CreativeInput,
): SkillResult {
  if (
    value?.type !== "result" ||
    value.version !== "deepagents-0.7.29/desvio-creative-v1" ||
    value.helpers_executed !== false ||
    !Number.isInteger(value.model_calls) ||
    value.model_calls < 1 ||
    value.model_calls > 3 ||
    !Array.isArray(value.skills) ||
    value.skills
      .map((s: any) => s.name)
      .sort()
      .join(",") !== selectedSkills(input.format).join(",") ||
    !Array.isArray(value.reads) ||
    value.reads.length > 50
  )
    throw new CreativeError("SKILL_OUTPUT_INVALID");
  for (const s of value.skills) {
    const pin = CREATIVE_SKILLS[s.name as keyof typeof CREATIVE_SKILLS];
    if (
      !pin ||
      s.skill_sha256 !== pin.skill_sha256 ||
      s.tree_sha256 !== pin.tree_sha256 ||
      !value.reads.includes(`/skills/${s.name}/SKILL.md`)
    )
      throw new CreativeError("SKILL_DIGEST_MISMATCH");
  }
  if (
    value.reads.some(
      (p: any) =>
        typeof p !== "string" ||
        p.includes("..") ||
        (!p.startsWith("/skills/") && p !== "/.agents/product-marketing.md"),
    )
  )
    throw new CreativeError("SKILL_PATH_DENIED");
  validateBrief(value.brief, input);
  return value;
}
