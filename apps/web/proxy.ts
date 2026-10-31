import {INGRESS_HEADERS,signIngressAddress,validIngressSecret} from "../api/src/auth-ingress.js";
import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  if(request.nextUrl.pathname.startsWith('/api/')) {
    const headers=new Headers(request.headers);
    for(const key of [...INGRESS_HEADERS,'x-desvio-peer-ip'])headers.delete(key);
    if(process.env.TRUST_RAILWAY_EDGE==='true') {
      const secret=process.env.AUTH_INGRESS_SECRET;
      if(!validIngressSecret(secret))return NextResponse.json({error:'Sign-in service unavailable'},{status:503});
      // Enable only for a web service reached through Railway's HTTP edge.
      // Never select an arbitrary first X-Forwarded-For entry.
      const ip=request.headers.get('x-real-ip');
      try {
        const proof=signIngressAddress(secret,ip??'',request.method,request.nextUrl.pathname);
        for(const [key,value] of Object.entries(proof))headers.set(key,value);
      } catch { return NextResponse.json({error:'Sign-in service unavailable'},{status:503}); }
    }
    return NextResponse.next({request:{headers}});
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const storage = process.env.S3_BROWSER_ORIGIN
    ? new URL(process.env.S3_BROWSER_ORIGIN).origin
    : "";
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' ${storage}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
