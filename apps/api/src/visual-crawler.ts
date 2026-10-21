import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";
import { SafeWeb, websiteURL, IntakeError } from "./safe-web.js";
import { digest } from "./object-store.js";
export const VISUAL_VERSION = "crawl4ai-0.9.5/chromium-1248/desvio-visual-v1";
export type VisualCapture = {
  version: string;
  url: string;
  coverage: string;
  requests: number;
  failures: { url: string; reason: string }[];
  snapshots: {
    viewport: { width: number; height: number };
    height: number;
    truncated: boolean;
    sha256: string;
    screenshot: string;
    observations: any;
  }[];
};
export class VisualCrawler {
  constructor(
    readonly image?: string,
    readonly web = new SafeWeb(),
  ) {}
  async capture(url: string, html: string): Promise<VisualCapture> {
    if (!this.image || !/^sha256:[a-f0-9]{64}$/.test(this.image))
      throw new IntakeError("WEBSITE_VISUAL_NOT_CONFIGURED");
    websiteURL(url);
    if (Buffer.byteLength(html) > 2 * 1024 * 1024)
      throw new IntakeError("WEBSITE_PAGE_TOO_LARGE");
    const name = `desvio-visual-${randomUUID()}`;
    try {
      const value = await new Promise<any>((resolve, reject) => {
        let line = "",
          total = 0,
          received = 0,
          requests = 0,
          active = 0,
          settled = false;
        const seen = new Set<string>();
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
            "256",
            "--memory",
            "1g",
            "--memory-swap",
            "1g",
            "--cpus",
            "1",
            "--tmpfs",
            "/tmp:rw,nosuid,size=256m",
            "--entrypoint",
            "python",
            this.image!,
            "/opt/visual.py",
          ],
          { stdio: ["pipe", "pipe", "ignore"] },
        );
        const timer = setTimeout(
          () => finish(new IntakeError("WEBSITE_VISUAL_TIMEOUT")),
          120000,
        );
        function finish(error?: Error, result?: unknown) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.stdin.end();
          if (error) {
            child.kill("SIGKILL");
            reject(error);
          } else resolve(result);
        }
        const reply = (v: unknown) => {
          if (!settled) child.stdin.write(JSON.stringify(v) + "\n");
        };
        const resource = async (message: any) => {
          if (
            typeof message.id !== "string" ||
            !/^\d{1,3}$/.test(message.id) ||
            seen.has(message.id) ||
            ++requests > 120
          ) {
            reply({ id: message.id, error: "RESOURCE_LIMIT" });
            return;
          }
          seen.add(message.id);
          while (active >= 4 && !settled)
            await new Promise((r) => setTimeout(r, 20));
          if (settled) return;
          active++;
          try {
            if (
              ![
                "script",
                "stylesheet",
                "image",
                "font",
                "fetch",
                "xhr",
                "other",
              ].includes(message.resourceType)
            )
              throw new IntakeError("RESOURCE_TYPE_BLOCKED");
            let target = websiteURL(message.url, true);
            for (let redirect = 0; redirect <= 3; redirect++) {
              if (
                ["fetch", "xhr", "other"].includes(message.resourceType) &&
                target.origin !== new URL(url).origin
              )
                throw new IntakeError("CROSS_ORIGIN_DATA_BLOCKED");
              if (total >= 20 * 1024 * 1024)
                throw new IntakeError("RESOURCE_BYTE_LIMIT");
              const r = await this.web.fetch(target, 2 * 1024 * 1024, "*/*");
              total += r.bytes.length;
              if (total > 20 * 1024 * 1024)
                throw new IntakeError("RESOURCE_BYTE_LIMIT");
              if ([301, 302, 303, 307, 308].includes(r.status)) {
                if (redirect === 3 || typeof r.headers.location !== "string")
                  throw new IntakeError("RESOURCE_REDIRECT_LIMIT");
                target = websiteURL(
                  new URL(r.headers.location, target).href,
                  true,
                );
                continue;
              }
              if (r.status < 200 || r.status >= 300)
                throw new IntakeError("RESOURCE_HTTP_ERROR");
              const type = String(
                r.headers["content-type"] ?? "application/octet-stream",
              );
              const headers: Record<string, string> = {
                "content-type": type,
                "cache-control": "no-store",
              };
              if (typeof r.headers["access-control-allow-origin"] === "string")
                headers["access-control-allow-origin"] =
                  r.headers["access-control-allow-origin"];
              reply({
                id: message.id,
                status: r.status,
                headers,
                body: r.bytes.toString("base64"),
              });
              return;
            }
          } catch {
            reply({ id: message.id, error: "RESOURCE_UNAVAILABLE" });
          } finally {
            active--;
          }
        };
        child.stdout.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > 24 * 1024 * 1024) {
            finish(new IntakeError("WEBSITE_VISUAL_OUTPUT_LIMIT"));
            return;
          }
          line += chunk.toString("utf8");
          let end;
          while ((end = line.indexOf("\n")) !== -1) {
            const raw = line.slice(0, end);
            line = line.slice(end + 1);
            let msg: any;
            try {
              msg = JSON.parse(raw);
            } catch {
              finish(new IntakeError("WEBSITE_VISUAL_OUTPUT_INVALID"));
              return;
            }
            if (msg.type === "fetch") void resource(msg);
            else if (msg.type === "result") finish(undefined, msg);
            else finish(new IntakeError("WEBSITE_VISUAL_CAPTURE_FAILED"));
          }
        });
        child.on("error", () =>
          finish(new IntakeError("WEBSITE_VISUAL_UNAVAILABLE")),
        );
        child.on("close", () => {
          if (!settled)
            finish(new IntakeError("WEBSITE_VISUAL_CAPTURE_FAILED"));
        });
        child.stdin.on("error", () => {});
        child.stdin.write(JSON.stringify({ url, html }) + "\n");
      });
      if (
        value?.version !== VISUAL_VERSION ||
        value.url !== url ||
        value.coverage !== "rendered_desktop_mobile" ||
        !Array.isArray(value.snapshots) ||
        value.snapshots.length !== 2 ||
        !Array.isArray(value.failures) ||
        value.failures.length > 120
      )
        throw new IntakeError("WEBSITE_VISUAL_OUTPUT_INVALID");
      for (const [i, shot] of value.snapshots.entries()) {
        if (
          shot.viewport?.width !== [1440, 390][i] ||
          shot.viewport?.height !== [1000, 844][i] ||
          !Number.isInteger(shot.height) ||
          shot.height < shot.viewport.height ||
          shot.height > 16000 ||
          typeof shot.screenshot !== "string" ||
          shot.screenshot.length > 8 * 1024 * 1024 ||
          typeof shot.truncated !== "boolean" ||
          !shot.observations ||
          Buffer.byteLength(JSON.stringify(shot.observations)) > 200000
        )
          throw new IntakeError("WEBSITE_VISUAL_OUTPUT_INVALID");
        const bytes = Buffer.from(shot.screenshot, "base64");
        if (digest(bytes) !== shot.sha256)
          throw new IntakeError("WEBSITE_VISUAL_OUTPUT_INVALID");
        const metadata = await sharp(bytes, {
          limitInputPixels: 25000000,
        }).metadata();
        if (
          metadata.format !== "jpeg" ||
          metadata.width !== shot.viewport.width ||
          metadata.height !== shot.height
        )
          throw new IntakeError("WEBSITE_VISUAL_OUTPUT_INVALID");
        // Validate text and observations before they can enter a model or product UI.
        const o = shot.observations;
        if (
          typeof o.text !== "string" ||
          o.text.length > 60000 ||
          !Array.isArray(o.colors) ||
          o.colors.length > 24 ||
          !Array.isArray(o.typography) ||
          o.typography.length > 20 ||
          !Array.isArray(o.images) ||
          o.images.length > 100 ||
          !Array.isArray(o.sections) ||
          o.sections.length > 80 ||
          !Array.isArray(o.links) ||
          o.links.length > 100
        )
          throw new IntakeError("WEBSITE_VISUAL_OUTPUT_INVALID");
      }
      return value;
    } finally {
      try {
        await promisify(execFile)("docker", ["rm", "-f", name], {
          timeout: 10000,
        });
      } catch {}
    }
  }
}
