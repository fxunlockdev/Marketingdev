import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signIngressAddress,resolveIngressAddress,validIngressSecret} from '../../dist/auth-ingress.js';
const secret='ab'.repeat(32),now=1793440000000,peer='10.0.0.5',method='POST',path='/api/auth/sign-in/email';
test('only a fresh route-bound trusted proof overrides the socket address',()=>{
 for(const ip of ['198.51.100.25','2001:db8::25']) {
  const h=signIngressAddress(secret,ip,method,path,now);
  assert.equal(resolveIngressAddress(h,peer,method,path,secret,now),ip);
  for(const patch of [{'x-desvio-client-ip':'198.51.100.99'},{'x-desvio-client-signature':'0'.repeat(64)},{'x-desvio-client-time':'0'},{'x-desvio-client-ip':[ip,ip]}])assert.equal(resolveIngressAddress({...h,...patch},peer,method,path,secret,now),peer);
  assert.equal(resolveIngressAddress(h,peer,'GET',path,secret,now),peer);
  assert.equal(resolveIngressAddress(h,peer,method,path+'?changed=1',secret,now),peer);
  assert.equal(resolveIngressAddress(h,peer,method,path,secret,now+31000),peer);
  assert.equal(resolveIngressAddress(h,peer,method,path,secret,now-31000),peer);
  assert.equal(resolveIngressAddress(h,peer,method,path,'cd'.repeat(32),now),peer);
  assert.equal(resolveIngressAddress(h,peer,method,path,undefined,now),peer);
 }
});
test('raw forwarding, lists and malformed addresses cannot select an auth bucket',()=>{
 assert.equal(resolveIngressAddress({'x-real-ip':'198.51.100.3','x-forwarded-for':'198.51.100.4','x-desvio-peer-ip':'198.51.100.5'},peer,method,path,secret,now),peer);
 for(const ip of ['', '198.51.100.1, 198.51.100.2','fake','fe80::1%eth0',' 198.51.100.1'])assert.throws(()=>signIngressAddress(secret,ip,method,path,now));
 for(const key of ['', 'ab', 'z'.repeat(64)])assert.equal(validIngressSecret(key),false);
});
