/** The local stack's mock Runway (scripts/local-stack/mock-runway.mjs). Honoured only in development or test
 * mode and only for a plain-HTTP 127.0.0.1 origin with a port, so no staging or production process can be
 * pointed at it. When set, the Runway adapter, reference leases and output download accept that loopback
 * origin; every other check is unchanged. */
export function localMockRunway(env:NodeJS.ProcessEnv=process.env):string|null{
 const raw=env.DESVIO_MOCK_RUNWAY_URL;
 if(!raw)return null;
 if(!['development','test'].includes(String(env.APP_MODE)))throw new Error('DESVIO_MOCK_RUNWAY_URL is only allowed in development or test mode');
 let url:URL;
 try{url=new URL(raw);}catch{throw new Error('DESVIO_MOCK_RUNWAY_URL must be an http://127.0.0.1:<port> origin');}
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.origin!==raw.replace(/\/$/,''))throw new Error('DESVIO_MOCK_RUNWAY_URL must be an http://127.0.0.1:<port> origin');
 return url.origin;
}
/** True for a plain-HTTP 127.0.0.1 URL with a port: the only non-HTTPS address the mock path accepts. */
export function loopbackURL(value:string):boolean{
 try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&!!u.port&&!u.username&&!u.password;}catch{return false;}
}
