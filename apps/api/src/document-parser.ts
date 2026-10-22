import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";
import { digest, MAX_UPLOAD_BYTES } from "./object-store.js";
export const PARSER_VERSION = "docling-native-2.141.0/tesseract-5.5.0/desvio-v3";
export type ParsedDocument = {
  parserVersion: string;
  sha256: string;
  pages: number;
  textPages: number[];
  kind: "pdf" | "pptx";
  coverage: "embedded_text_only" | "embedded_text_with_ocr";
  ocrPages: number[];
  visuals: { page: number; width: number; height: number; sha256: string; image: string }[];
  chunks: {
    text: string;
    page: number;
    anchor: string;
    bbox: Record<string, unknown>;
  }[];
};
export class DocumentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const invalid = () => new DocumentError("INVALID_DOCUMENT_OUTPUT");
export function parseDocumentOutput(
  raw: string,
  bytes: Buffer,
  kind: "pdf" | "pptx",
): ParsedDocument {
  let v: any;
  try {
    v = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  if (v?.error) {
    const codes = [
      "DOCUMENT_LIMIT_EXCEEDED",
      "UNSAFE_PRESENTATION",
      "INVALID_PRESENTATION",
      "UNSUPPORTED_DOCUMENT",
      "DOCUMENT_PARSE_FAILED",
      "INVALID_DOCUMENT_PROVENANCE",
      "DOCUMENT_NEEDS_OCR_OR_MANUAL_REVIEW",
      "DOCUMENT_NATIVE_FAILED",
      "DOCUMENT_CONVERSION_FAILED",
      "DOCUMENT_OCR_OUTPUT_INVALID",
      "DOCUMENT_RENDER_FAILED",
      "DOCUMENT_PAGE_DIMENSIONS_INVALID",
      "PRESENTATION_EXTERNAL_RESOURCE_UNSUPPORTED",
      "PRESENTATION_EMBEDDED_OBJECT_UNSUPPORTED",
    ];
    throw new DocumentError(
      codes.includes(v.error) ? v.error : "DOCUMENT_PARSE_FAILED",
    );
  }
  if (
    !v ||
    v.parserVersion !== PARSER_VERSION ||
    v.sha256 !== digest(bytes) ||
    v.kind !== kind ||
    !["embedded_text_only", "embedded_text_with_ocr"].includes(v.coverage) ||
    !Number.isInteger(v.pages) ||
    v.pages < 1 ||
    v.pages > 50 ||
    !Array.isArray(v.chunks) ||
    !v.chunks.length ||
    v.chunks.length > 2000
  )
    throw invalid();
  let size = 0;
  if (!Array.isArray(v.visuals) || v.visuals.length !== v.pages) throw invalid();
  let visualBytes = 0;
  for (const [index, visual] of v.visuals.entries()) {
    if (visual?.page !== index + 1 || ![visual.width, visual.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2000) || typeof visual.image !== "string" || visual.image.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(visual.image)) throw invalid();
    const image = Buffer.from(visual.image, "base64");
    if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff || image.toString("base64") !== visual.image || image.length > 2 * 1024 * 1024 || digest(image) !== visual.sha256) throw invalid();
    visualBytes += image.length;
  }
  if (visualBytes > 24 * 1024 * 1024) throw invalid();
  const pages = new Set<number>();
  const ocrPages = new Set<number>();
  for (const c of v.chunks) {
    if (
      !c ||
      typeof c.text !== "string" ||
      !c.text.trim() ||
      c.text.length > 12000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c.text) ||
      !Number.isInteger(c.page) ||
      c.page < 1 ||
      c.page > v.pages ||
      typeof c.anchor !== "string" ||
      c.anchor.length > 200 ||
      !c.bbox ||
      typeof c.bbox !== "object" ||
      !["l", "t", "r", "b"].every((k) => Number.isFinite(c.bbox[k])) ||
      !["TOPLEFT", "BOTTOMLEFT"].includes(c.bbox.coord_origin)
    )
      throw invalid();
    size += c.text.length;
    pages.add(c.page);
    if (c.bbox.method !== undefined) {
      if (c.bbox.method !== "ocr_eng" || !Number.isFinite(c.bbox.confidence) || c.bbox.confidence < 0 || c.bbox.confidence > 100 || c.bbox.coord_origin !== "TOPLEFT" || !c.anchor.startsWith(`#/ocr/${c.page}/`)) throw invalid();
      ocrPages.add(c.page);
    } else if (c.anchor.startsWith("#/ocr/")) throw invalid();
  }
  if (
    size > 250000 ||
    JSON.stringify(v.ocrPages) !== JSON.stringify([...ocrPages].sort((a, b) => a - b)) ||
    v.coverage !== (ocrPages.size ? "embedded_text_with_ocr" : "embedded_text_only") ||
    !Array.isArray(v.textPages) ||
    JSON.stringify(v.textPages) !==
      JSON.stringify([...pages].sort((a, b) => a - b))
  )
    throw invalid();
  return {
    parserVersion: v.parserVersion,
    sha256: v.sha256,
    pages: v.pages,
    textPages: v.textPages,
    kind,
    coverage: v.coverage,
    ocrPages: v.ocrPages,
    visuals: v.visuals.map((p: any) => ({page:p.page,width:p.width,height:p.height,sha256:p.sha256,image:p.image})),
    chunks: v.chunks.map((c: any) => ({
      text: c.text,
      page: c.page,
      anchor: c.anchor,
      bbox: {
        l: c.bbox.l,
        t: c.bbox.t,
        r: c.bbox.r,
        b: c.bbox.b,
        coord_origin: c.bbox.coord_origin,
        ...(c.bbox.method ? { method: c.bbox.method, confidence: c.bbox.confidence } : {}),
      },
    })),
  };
}
// Only a trusted dedicated worker may launch containers. Never pass credentials,
// volumes, host networking, user-controlled images or parser command arguments.
export class DocumentParser {
  constructor(readonly image?: string) {
    if (image && !/^sha256:[a-f0-9]{64}$/.test(image))
      throw new Error(
        "DOCUMENT_PARSER_IMAGE must be an exact local image digest",
      );
  }
  async parse(bytes: Buffer, kind: "pdf" | "pptx"): Promise<ParsedDocument> {
    if (!this.image) throw new DocumentError("DOCUMENT_PARSER_NOT_CONFIGURED");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
      throw new DocumentError("DOCUMENT_LIMIT_EXCEEDED");
    if (!["pdf", "pptx"].includes(kind))
      throw new DocumentError("UNSUPPORTED_DOCUMENT");
    const parsed = parseDocumentOutput(
      await runIntakeSandbox(this.image, bytes, kind),
      bytes,
      kind,
    );
    for (const visual of parsed.visuals) {
      try {
        const decoded = await sharp(Buffer.from(visual.image, "base64"), { limitInputPixels: 4000000, failOn: "warning" }).raw().toBuffer({ resolveWithObject: true });
        if (decoded.info.width !== visual.width || decoded.info.height !== visual.height) throw invalid();
      } catch { throw invalid(); }
    }
    return parsed;
  }
}
export async function runIntakeSandbox(
  image: string,
  bytes: Buffer,
  kind: "pdf" | "pptx" | "website",
) {
  if (
    !/^sha256:[a-f0-9]{64}$/.test(image) ||
    !["pdf", "pptx", "website"].includes(kind)
  )
    throw new Error("INVALID_SANDBOX_CONFIG");
  const name = `desvio-parser-${randomUUID()}`;
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      let output = "",
        length = 0,
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
          "desvio.purpose=document-sandbox",
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "64",
          "--memory",
          "1g",
          "--memory-swap",
          "1g",
          "--cpus",
          "1",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=96m",
          image,
          kind,
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          child.kill("SIGKILL");
          reject(error);
        } else resolve(output);
      };
      const timer = setTimeout(
        () => finish(new DocumentError("DOCUMENT_PARSE_TIMEOUT")),
        120000,
      );
      child.on("error", () =>
        finish(new Error("DOCUMENT_SANDBOX_UNAVAILABLE")),
      );
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > (kind === "website" ? 2 : 36) * 1024 * 1024) finish(invalid());
        else output += chunk.toString("utf8");
      });
      child.stdin.on("error", () => {});
      child.stdin.end(bytes);
      child.on("close", (code) => {
        if (code === 0 || code === 2) finish();
        else finish(new Error("DOCUMENT_SANDBOX_UNAVAILABLE"));
      });
    });
    return raw;
  } finally {
    try {
      await promisify(execFile)("docker", ["rm", "-f", name], {
        timeout: 10000,
      });
    } catch {}
  }
}
