import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import robotsModule from "robots-parser";
type Robots = {
  isAllowed(url: string, agent: string): boolean | undefined;
  getCrawlDelay(agent: string): number | undefined;
};
const robotsParser = robotsModule as unknown as (
  url: string,
  text: string,
) => Robots;

export class IntakeError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const denied = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["168.63.129.16", 32],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(ip, bits, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [ip, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3ffe::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(ip, bits, "ipv6");
export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !denied.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !denied.check(address, "ipv6");
}
export function websiteURL(input: string, allowQuery = false) {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new IntakeError("INVALID_WEBSITE_URL");
  }
  if (
    input.length > 2048 ||
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port ||
    (!allowQuery && u.search) ||
    !u.hostname.includes(".") ||
    isIP(u.hostname.replace(/^\[|\]$/g, "")) ||
    u.hostname.endsWith(".local") ||
    u.hostname.endsWith(".internal") ||
    u.hostname.endsWith(".localhost") ||
    u.hostname.endsWith(".")
  )
    throw new IntakeError("UNSAFE_WEBSITE_URL");
  u.hash = "";
  return u;
}
const agent = "DesvioBot";
type WebResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bytes: Buffer;
};
export type Resolve = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;
// Test seams belong to constructors only; never expose resolver/transport overrides in config or HTTP input.
export class SafeWeb {
  constructor(
    readonly resolve: Resolve = (host) =>
      lookup(host, { all: true, verbatim: true }),
  ) {}
  async fetch(
    url: URL,
    maxBytes = 2 * 1024 * 1024,
    accept = "text/html,text/plain;q=0.9",
  ): Promise<WebResponse> {
    websiteURL(url.href, true);
    const addresses = await Promise.race([
      this.resolve(url.hostname),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new IntakeError("WEBSITE_DNS_TIMEOUT")),
          5000,
        );
        t.unref();
      }),
    ]);
    if (
      !addresses.length ||
      addresses.length > 32 ||
      addresses.some(
        (a) => !publicAddress(a.address) || isIP(a.address) !== a.family,
      )
    )
      throw new IntakeError("WEBSITE_ADDRESS_BLOCKED");
    const selected = addresses[0];
    return new Promise((resolve, reject) => {
      let done = false;
      const chunks: Buffer[] = [];
      let size = 0;
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          agent: false,
          method: "GET",
          headers: {
            "user-agent": agent,
            accept: accept,
            "accept-encoding": "identity",
          },
          // Connect to the checked address, while retaining original Host and TLS SNI/certificate validation.
          lookup: ((_host: any, options: any, cb: any) =>
            options.all
              ? cb(null, [selected])
              : cb(null, selected.address, selected.family)) as any,
        },
        (res) => {
          const encoding = res.headers["content-encoding"];
          if (encoding && encoding !== "identity") {
            res.destroy();
            finish(new IntakeError("WEBSITE_ENCODING_UNSUPPORTED"));
            return;
          }
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              finish(new IntakeError("WEBSITE_PAGE_TOO_LARGE"));
            } else chunks.push(chunk);
          });
          res.on("error", () =>
            finish(new IntakeError("WEBSITE_FETCH_FAILED")),
          );
          res.on("end", () =>
            finish(undefined, {
              status: res.statusCode ?? 0,
              headers: res.headers,
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      const timer = setTimeout(
        () => finish(new IntakeError("WEBSITE_FETCH_TIMEOUT")),
        15000,
      );
      function finish(error?: Error, result?: WebResponse) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        req.destroy();
        if (error) reject(error);
        else resolve(result!);
      }
      req.on("error", () => finish(new IntakeError("WEBSITE_FETCH_FAILED")));
      req.end();
    });
  }
}
export type HtmlPage = { url: string; html: string; sha256: string };
export class WebsiteReader {
  constructor(readonly web = new SafeWeb()) {}
  async read(
    start: string,
    onPage: (url: string, html: string) => Promise<string[]>,
    check: () => Promise<void> = async () => {},
  ) {
    const root = websiteURL(start),
      queue = [root.href],
      seen = new Set<string>(),
      pages: string[] = [],
      skipped: { url: string; code: string }[] = [];
    const policies = new Map<string, ReturnType<typeof robotsParser>>();
    let requests = 0;
    const sameSite = (url: URL) =>
      url.hostname.replace(/^www\./, "") ===
        root.hostname.replace(/^www\./, "") &&
      !(root.protocol === "https:" && url.protocol === "http:");
    const fetch = async (url: URL, max?: number) => {
      await check();
      if (++requests > 18) throw new IntakeError("WEBSITE_REQUEST_LIMIT");
      return this.web.fetch(url, max);
    };
    async function allowed(url: URL) {
      if (!policies.has(url.origin)) {
        const r = await fetch(new URL("/robots.txt", url), 256 * 1024);
        if (r.status !== 404 && (r.status < 200 || r.status >= 300))
          throw new IntakeError("WEBSITE_ROBOTS_UNAVAILABLE");
        const p = robotsParser(
          url.origin + "/robots.txt",
          r.status === 404 ? "" : r.bytes.toString("utf8"),
        );
        policies.set(url.origin, p);
      }
      const p = policies.get(url.origin)!;
      if (p.isAllowed(url.href, agent) === false)
        throw new IntakeError("WEBSITE_ROBOTS_DISALLOWED");
      const delay = p.getCrawlDelay(agent);
      if (delay !== undefined && delay > 10)
        throw new IntakeError("WEBSITE_CRAWL_DELAY_TOO_LONG");
      // Sequential bounded reads honor at least one second between page requests.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(1, delay ?? 1) * 1000),
      );
    }
    while (queue.length && pages.length < 5 && seen.size < 12) {
      let url = websiteURL(queue.shift()!);
      if (seen.has(url.href)) continue;
      const initial = url.href;
      seen.add(initial);
      try {
        let response: WebResponse | undefined;
        for (let redirect = 0; redirect <= 3; redirect++) {
          if (!sameSite(url)) throw new IntakeError("WEBSITE_REDIRECT_BLOCKED");
          await allowed(url);
          response = await fetch(url);
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.location;
          if (typeof location !== "string" || redirect === 3)
            throw new IntakeError("WEBSITE_REDIRECT_LIMIT");
          url = websiteURL(new URL(location, url).href);
        }
        if (!response || response.status < 200 || response.status >= 300)
          throw new IntakeError("WEBSITE_HTTP_ERROR");
        if (
          !/^text\/html(?:;|$)/i.test(
            String(response.headers["content-type"] ?? ""),
          )
        )
          throw new IntakeError("WEBSITE_NOT_HTML");
        if (
          /charset\s*=\s*(?!utf-8|us-ascii)[a-z0-9-]+/i.test(
            String(response.headers["content-type"]),
          )
        )
          throw new IntakeError("WEBSITE_ENCODING_UNSUPPORTED");
        const html = new TextDecoder("utf-8", { fatal: true }).decode(
          response.bytes,
        );
        const links = await onPage(url.href, html);
        pages.push(url.href);
        seen.add(url.href);
        for (const href of links.slice(0, 100)) {
          try {
            const candidate = websiteURL(new URL(href, url).href);
            if (
              sameSite(candidate) &&
              !/(?:^|\/)(?:login|logout|checkout|cart|account|search)(?:\/|$)/i.test(
                candidate.pathname,
              ) &&
              !seen.has(candidate.href) &&
              queue.length < 30
            )
              queue.push(candidate.href);
          } catch {}
        }
        const relevance = (u: string) =>
          /\/(about|our-story|brand|products?|services?|collections?)([\/-]|$)/i.test(
            new URL(u).pathname,
          )
            ? 2
            : /privacy|terms|cookies/i.test(u)
              ? -1
              : 0;
        queue.sort((a, b) => relevance(b) - relevance(a));
      } catch (error) {
        skipped.push({
          url: initial,
          code:
            error instanceof IntakeError ? error.code : "WEBSITE_READ_FAILED",
        });
        if (!pages.length) throw error;
      }
    }
    return {
      pages,
      skipped,
      coverage: "server_html_only",
      pageLimit: 5,
      requests,
    };
  }
}
