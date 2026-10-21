import { fileURLToPath } from "node:url";
const api = new URL(process.env.API_ORIGIN ?? "http://127.0.0.1:3100");
if (
  !["http:", "https:"].includes(api.protocol) ||
  api.username ||
  api.password ||
  api.pathname !== "/"
)
  throw new Error("API_ORIGIN must be a plain server origin");
export default {
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api.origin}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
