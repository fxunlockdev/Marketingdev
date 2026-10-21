import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { digest, MAX_UPLOAD_BYTES } from "./object-store.js";
export const PARSER_VERSION = "docling-native-2.141.0/desvio-v1";
export type ParsedDocument = {
  parserVersion: string;
  sha256: string;
  pages: number;
  textPages: number[];
  kind: "pdf" | "pptx";
  coverage: "embedded_text_only";
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
    v.coverage !== "embedded_text_only" ||
    !Number.isInteger(v.pages) ||
    v.pages < 1 ||
    v.pages > 50 ||
    !Array.isArray(v.chunks) ||
    !v.chunks.length ||
    v.chunks.length > 2000
  )
    throw invalid();
  let size = 0;
  const pages = new Set<number>();
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
  }
  if (
    size > 250000 ||
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
            this.image!,
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
          if (length > 2 * 1024 * 1024) finish(invalid());
          else output += chunk.toString("utf8");
        });
        child.stdin.on("error", () => {});
        child.stdin.end(bytes);
        child.on("close", (code) => {
          if (code === 0 || code === 2) finish();
          else finish(new Error("DOCUMENT_SANDBOX_UNAVAILABLE"));
        });
      });
      return parseDocumentOutput(raw, bytes, kind);
    } finally {
      try {
        await promisify(execFile)("docker", ["rm", "-f", name], {
          timeout: 10000,
        });
      } catch {}
    }
  }
}
