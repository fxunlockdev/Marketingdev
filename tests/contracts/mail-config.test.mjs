import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mailConfig} from '../../dist/mail-config.js';
test('Resend uses fixed TLS transport and cannot redirect its credential through SMTP overrides',()=>{
 const env={MAIL_PROVIDER:'resend',RESEND_API_KEY:'fixture-secret',RESEND_FROM:'mail@example.test',SMTP_HOST:'attacker.example',SMTP_PORT:'25',SMTP_SECURE:'false',SMTP_USER:'other',SMTP_PASSWORD:'other',SMTP_FROM:'other@example.test'};
 assert.deepEqual(mailConfig(env,'staging'),{host:'smtp.resend.com',port:465,secure:true,user:'resend',password:'fixture-secret',from:'mail@example.test'});
 for(const key of ['RESEND_API_KEY','RESEND_FROM'])assert.throws(()=>mailConfig({...env,[key]:''},'staging'),new RegExp(key+' is required'));
 for(const from of ['Bad <mail@example.test>','a@example.test,b@example.test','a@example.test\r\nBcc: x@example.test'])assert.throws(()=>mailConfig({...env,RESEND_FROM:from},'staging'));
 assert.throws(()=>mailConfig({...env,MAIL_PROVIDER:'unknown'},'staging'));
});
test('local SMTP remains available while staging rejects missing credentials and unsafe configuration',()=>{
 const env={SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025',SMTP_FROM:'mail@example.test'};
 assert.equal(mailConfig(env,'test').port,1025);assert.throws(()=>mailConfig(env,'staging'),/Authenticated/);
 for(const patch of [{SMTP_PORT:'0'},{SMTP_PORT:'65536'},{SMTP_PORT:'abc'},{SMTP_SECURE:'yes'}])assert.throws(()=>mailConfig({...env,...patch},'test'));
});
