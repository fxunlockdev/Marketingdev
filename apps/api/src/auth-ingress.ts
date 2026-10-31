import {createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';

export const INGRESS_HEADERS=['x-desvio-client-ip','x-desvio-client-time','x-desvio-client-signature'] as const;
export function validIngressSecret(secret:unknown):secret is string{return typeof secret==='string'&&/^[a-f0-9]{64}$/i.test(secret);}
function validAddress(ip:unknown):ip is string{return typeof ip==='string'&&ip.length<=45&&!ip.includes('%')&&isIP(ip)!==0;}
function signature(secret:string,ip:string,time:string,method:string,path:string){
 return createHmac('sha256',Buffer.from(secret,'hex')).update(JSON.stringify(['desvio-ingress-v1',ip,time,method,path])).digest('hex');
}
/** Server-to-server metadata only. This proof never authenticates a user. */
export function signIngressAddress(secret:string,ip:string,method:string,path:string,now=Date.now()):Record<string,string>{
 if(!validIngressSecret(secret)||!validAddress(ip))throw new Error('Invalid ingress configuration or address');
 const time=String(Math.floor(now/1000));
 return {'x-desvio-client-ip':ip,'x-desvio-client-time':time,'x-desvio-client-signature':signature(secret,ip,time,method,path)};
}
/** Unconfigured, forged or expired forwarding always falls back to the socket peer. */
export function resolveIngressAddress(headers:Record<string,string|string[]|undefined>,peer:string,method:string,path:string,secret?:string,now=Date.now()):string{
 const ip=headers[INGRESS_HEADERS[0]],time=headers[INGRESS_HEADERS[1]],proof=headers[INGRESS_HEADERS[2]];
 if(!validIngressSecret(secret)||!validAddress(ip)||typeof time!=='string'||!/^\d{10}$/.test(time)||Math.abs(Math.floor(now/1000)-Number(time))>30||typeof proof!=='string'||! /^[a-f0-9]{64}$/.test(proof))return peer;
 const expected=signature(secret,ip,time,method,path);
 return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(proof,'hex'))?ip:peer;
}
