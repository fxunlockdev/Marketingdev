import { runIntakeSandbox } from "./document-parser.js";
import { digest } from "./object-store.js";
import { IntakeError } from "./safe-web.js";
export const WEBSITE_PARSER_VERSION = "crawl4ai-0.9.5/desvio-v1";
export type WebsitePage = {
  parserVersion: string;
  url: string;
  sha256: string;
  chunks: { text: string; anchor: string }[];
  links: string[];
  truncated: boolean;
  coverage: "server_html_only" | "rendered_desktop_mobile";
};
export class WebsiteParser {
  constructor(readonly image?: string) {}
  async parse(url: string, html: string): Promise<WebsitePage> {
    if (!this.image) throw new IntakeError("WEBSITE_PARSER_NOT_CONFIGURED");
    const raw = await runIntakeSandbox(
      this.image,
      Buffer.from(JSON.stringify({ url, html })),
      "website",
    );
    let v: any;
    try {
      v = JSON.parse(raw);
    } catch {
      throw new IntakeError("WEBSITE_PARSE_FAILED");
    }
    if (
      v?.parserVersion !== WEBSITE_PARSER_VERSION ||
      v.url !== url ||
      v.sha256 !== digest(Buffer.from(html)) ||
      v.coverage !== "server_html_only" ||
      typeof v.truncated !== "boolean" ||
      !Array.isArray(v.chunks) ||
      !v.chunks.length ||
      v.chunks.length > 5 ||
      !Array.isArray(v.links) ||
      v.links.length > 100
    )
      throw new IntakeError("WEBSITE_PARSE_FAILED");
    for (const c of v.chunks)
      if (
        typeof c.text !== "string" ||
        !c.text.trim() ||
        c.text.length > 8000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c.text) ||
        !/^text:\d{1,5}$/.test(c.anchor)
      )
        throw new IntakeError("WEBSITE_PARSE_FAILED");
    if (v.links.some((x: any) => typeof x !== "string" || x.length > 2048))
      throw new IntakeError("WEBSITE_PARSE_FAILED");
    return v;
  }
}
