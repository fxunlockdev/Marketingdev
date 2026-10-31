import {chatSchema} from './chat-contracts.js';
import {CREATIVE_PLANNER_LIMITS} from './creative-budget.js';
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { canonicalJSON, hash } from "./brand-brain.js";
import {
  CreativeError,
  creativeBriefSchema,
  type PlannerRequest,
  type PlannerResponse,
} from "./creative-contracts.js";
import { digest } from "./object-store.js";
export class CreativeProvider {
  readonly sdk?: OpenAI;
  constructor(key?: string, sdk?: OpenAI) {
    this.sdk =
      sdk ??
      (key
        ? new OpenAI({ apiKey: key, maxRetries: 0, timeout: 120000 })
        : undefined);
  }
  get configured() {
    return !!this.sdk;
  }
  plannerRequest(request: PlannerRequest, model: string, maxOutputTokens:4000|16000=4000) {
    if (
      !Number.isInteger(request.step) ||
      request.step < 1 ||
      request.step > CREATIVE_PLANNER_LIMITS.steps ||
      !request.messages.length ||
      request.messages.length > 30 ||
      request.tools.length > 1 ||
      request.tools.some(
        (t) => t?.type !== "function" || t.function?.name !== "read_file",
      )
    )
      throw new CreativeError("SKILL_BROKER_INVALID");
    const input: any[] = [];
    for (const m of request.messages) {
      if(m.provider_context)throw new CreativeError("SKILL_BROKER_INVALID");
      if (
        !["system", "user", "assistant", "tool"].includes(m.role) ||
        typeof m.content !== "string"
      )
        throw new CreativeError("SKILL_BROKER_INVALID");
      if (m.role === "tool") {
        if (typeof m.tool_call_id !== "string" || m.tool_call_id.length > 200)
          throw new CreativeError("SKILL_BROKER_INVALID");
        input.push({
          type: "function_call_output",
          call_id: m.tool_call_id,
          output: m.content,
        });
      } else {
        if (m.content) input.push({ role: m.role, content: m.content });
        for (const t of m.tool_calls ?? []) {
          if (t.name !== "read_file" || typeof t.id !== "string")
            throw new CreativeError("SKILL_TOOL_DENIED");
          input.push({
            type: "function_call",
            call_id: t.id,
            name: t.name,
            arguments: canonicalJSON(t.args),
          });
        }
      }
    }
    const body = {
      model,
      store: false as const,
      max_output_tokens: maxOutputTokens,
      input,
      tools: request.tools.map((t) => ({
        type: "function" as const,
        name: "read_file",
        description: t.function.description,
        parameters: t.function.parameters,
        strict: false,
      })),
      parallel_tool_calls: false,
      ...(model==='gpt-6-sol'?{reasoning:{effort:'low' as const}}:{}),
      ...(request.chat_response?{reasoning:{effort:'low' as const},text:{format:{type:'json_schema' as const,name:'desvio_chat',strict:true,schema:chatSchema}}}:{}),
      ...(request.creative_fact_ids?{text:{format:{type:'json_schema' as const,name:'desvio_creative_brief',strict:true,schema:creativeBriefSchema(request.creative_fact_ids)}}}:{}),
    };
    const bytes = Buffer.byteLength(canonicalJSON(body));
    if (bytes > CREATIVE_PLANNER_LIMITS.bodyBytes) throw new CreativeError("SKILL_INPUT_LIMIT");
    return {
      body,
      sha256: hash(canonicalJSON(body)),
      maxInputTokens: bytes + CREATIVE_PLANNER_LIMITS.inputAllowance,
      maxOutputTokens,
    };
  }
  async plan(request: PlannerRequest, model: string, maxOutputTokens:4000|16000=4000): Promise<PlannerResponse> {
    if (!this.sdk) throw new CreativeError("CREATIVE_PROVIDER_NOT_CONFIGURED");
    const response = await this.sdk.responses.create(
      this.plannerRequest(request, model, maxOutputTokens).body,
      { timeout: 60000 },
    );
    if (
      response.status !== "completed" ||
      response.output.some(
        (o: any) =>
          o.type === "message" &&
          o.content.some((c: any) => c.type === "refusal"),
      )
    )
      throw new CreativeError("CREATIVE_PLAN_REJECTED");
    const tool_calls = response.output
      .filter((o: any) => o.type === "function_call")
      .map((o: any) => {
        if (o.name !== "read_file")
          throw new CreativeError("SKILL_TOOL_DENIED");
        let args;
        try {
          args = JSON.parse(o.arguments);
        } catch {
          throw new CreativeError("SKILL_RESPONSE_INVALID");
        }
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new CreativeError("SKILL_RESPONSE_INVALID");
        return { id: o.call_id, name: o.name, args };
      });
    if (tool_calls.length > 4)
      throw new CreativeError("SKILL_RESPONSE_INVALID");
    return {
      content: response.output_text,
      tool_calls,
      response_id: response.id,
      usage: response.usage,
    };
  }
  imageRequest(
    model: string,
    prompt: string,
    size: string,
    quality: string,
    safetyIdentifier: string,
  ) {
    if (
      !/^gpt-image-[a-z0-9.-]{1,70}$/.test(model) ||
      !["1024x1024", "1536x1024", "1024x1536"].includes(size) ||
      !["low", "medium", "high"].includes(quality) ||
      !prompt.trim() ||
      prompt.length > 20000 ||
      !/^[a-f0-9]{64}$/.test(safetyIdentifier)
    )
      throw new CreativeError("CREATIVE_IMAGE_CONFIG_INVALID");
    return {
      model,
      prompt,
      size,
      quality: quality as "low" | "medium" | "high",
      n: 1,
      output_format: "png" as const,
      safety_identifier: safetyIdentifier,
    };
  }
  async image(
    model: string,
    prompt: string,
    size: string,
    quality: string,
    safetyIdentifier: string,
    parent?: Buffer,
    references: Buffer[] = [],
  ) {
    if (!this.sdk) throw new CreativeError("CREATIVE_PROVIDER_NOT_CONFIGURED");
    const body = this.imageRequest(
      model,
      prompt,
      size,
      quality,
      safetyIdentifier,
    );
    if(references.length>3)throw new CreativeError('CREATIVE_REFERENCE_INVALID');
    const images=[...(parent?[parent]:[]),...references];
    for(const bytes of images){
      if(!Buffer.isBuffer(bytes)||bytes.length>20*1024*1024)throw new CreativeError('CREATIVE_REFERENCE_INVALID');
      const m=await sharp(bytes,{limitInputPixels:4_000_000}).metadata();
      if(m.format!=='png')throw new CreativeError('CREATIVE_REFERENCE_INVALID');
      await sharp(bytes,{limitInputPixels:4_000_000}).raw().toBuffer();
    }
    const response = images.length
      ? await this.sdk.images.edit({
          ...body,
          image: references.length ? await Promise.all(images.map((bytes,i)=>toFile(bytes,`reference-${i+1}.png`,{type:'image/png'}))) : await toFile(parent!, 'previous-version.png', {type:'image/png'}),
        })
      : await this.sdk.images.generate(body);
    const base64 = response.data?.[0]?.b64_json;
    if (
      response.data?.length !== 1 ||
      typeof base64 !== "string" ||
      base64.length > 28 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    )
      throw new CreativeError("CREATIVE_IMAGE_INVALID");
    const bytes = Buffer.from(base64, "base64"),
      [width, height] = size.split("x").map(Number);
    let metadata;
    try {
      metadata = await sharp(bytes, { limitInputPixels: 4_000_000 }).metadata();
    } catch {
      throw new CreativeError("CREATIVE_IMAGE_INVALID");
    }
    if (
      metadata.format !== "png" ||
      metadata.width !== width ||
      metadata.height !== height
    )
      throw new CreativeError("CREATIVE_IMAGE_INVALID");
    // Decode and re-encode the provider output before storing it as product media.
    const image = await sharp(bytes, { limitInputPixels: 4_000_000 })
      .png()
      .toBuffer();
    return {
      bytes: image,
      sha256: digest(image),
      width,
      height,
      usage: response.usage ?? null,
      created: response.created,
    };
  }
}
