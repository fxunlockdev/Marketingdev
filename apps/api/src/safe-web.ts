import {gunzip,brotliDecompress,inflate} from 'node:zlib';
import {promisify} from 'node:util';
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
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
// Keep compressed and decoded bodies bounded independently. Binary media callers
// retain identity-only responses; text pages may use standard HTTP compression.
export async function decodeWebsiteBody(bytes:Buffer,encoding:string|undefined,maxBytes:number){
 if(bytes.length>maxBytes)throw new IntakeError('WEBSITE_PAGE_TOO_LARGE');
 if(!encoding||encoding==='identity')return bytes;
 const decoder=new Map([['gzip',promisify(gunzip)],['br',promisify(brotliDecompress)],['deflate',promisify(inflate)]]).get(encoding);
 if(!decoder)throw new IntakeError('WEBSITE_ENCODING_UNSUPPORTED');
 try{return await decoder(bytes,{maxOutputLength:maxBytes});}
 catch(error:any){throw new IntakeError(error?.code==='ERR_BUFFER_TOO_LARGE'?'WEBSITE_PAGE_TOO_LARGE':'WEBSITE_COMPRESSION_INVALID');}
}
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
    timeoutMs = 15000,
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
          if (encoding && encoding !== 'identity' && (!accept.startsWith('text/') || !['gzip','br','deflate'].includes(encoding))) {
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
          res.on("end", async () => {
            try {
              const bytes=await decodeWebsiteBody(Buffer.concat(chunks),encoding,maxBytes);
              const headers={...res.headers};
              if(encoding&&encoding!=='identity'){delete headers['content-encoding'];headers['content-length']=String(bytes.length);}
              finish(undefined,{status:res.statusCode??0,headers,bytes});
            }catch(error){finish(error instanceof IntakeError?error:new IntakeError('WEBSITE_COMPRESSION_INVALID'));}
          });
        },
      );
      const timer = setTimeout(
        () => finish(new IntakeError("WEBSITE_FETCH_TIMEOUT")),
        Math.max(1,Math.min(15000,timeoutMs)),
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
