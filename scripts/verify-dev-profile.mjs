// Uses only a separately provisioned, disposable synthetic dev account.
// Never accepts the owner's credentials or changes production accounts.
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createOTP} from '@better-auth/utils/otp';
import {setTimeout as pause} from 'node:timers/promises';
import {base32} from '@better-auth/utils/base32';
const credentials=JSON.parse(readFileSync('work/dev-browser-probe-credentials.json'));
const origin='https://desvio-dev-web-dev.up.railway.app';
assert.equal(credentials.origin,origin);
assert.equal(credentials.email,credentials.user_id+'@desvio-probe.invalid');
const report={checked_at:new Date().toISOString(),passed:false,origin,checks:[],scope:'Actual deployed synthetic profile/password/session/authenticator acceptance. Email delivery and provider generation are excluded.'};
const browser=await chromium.launch(),context=await browser.newContext(),other=await browser.newContext(),page=await context.newPage();
let stage='login',passwordChanged=false;const failures=[];page.on('response',r=>{if(r.status()>=400)failures.push({path:new URL(r.url()).pathname,status:r.status()});});
const password=credentials.password,updated=password+'-profile';
const login=(ctx,pw)=>ctx.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:{email:credentials.email,password:pw}});
try {
 assert.equal((await login(context,password)).status(),200);
 assert.equal((await login(other,password)).status(),200);
 await page.goto(origin+'/profile');
 await expect(page.getByRole('heading',{name:'Profile',exact:true})).toBeVisible();
 stage='name';await page.getByLabel('Your name',{exact:true}).fill('Internal profile acceptance '+report.checked_at.slice(11,19));
 await page.getByRole('button',{name:'Save name',exact:true}).click();
 await expect(page.getByText('Your name is saved.',{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByLabel('Your name',{exact:true})).toHaveValue('Internal profile acceptance '+report.checked_at.slice(11,19));report.checks.push('name_persists');
 stage='session revocation';await page.getByRole('button',{name:'Sign out all other sessions',exact:true}).click();
 await page.getByRole('button',{name:'Confirm sign-out of other sessions',exact:true}).click();
 await expect(page.getByText('Other sessions signed out.',{exact:true})).toBeVisible();
 assert.equal(await (await other.request.get(origin+'/api/auth/get-session')).json(),null);report.checks.push('other_session_revoked');
 assert.equal((await login(other,password)).status(),200);
 stage='password change';await page.getByLabel('Current password',{exact:true}).fill(password);
 await page.getByLabel('New password',{exact:true}).fill(updated);await page.getByLabel('Confirm new password',{exact:true}).fill(updated);
 await page.getByRole('button',{name:'Change password',exact:true}).click();
 await expect(page.getByText('Password changed. Other sessions have been signed out.',{exact:true})).toBeVisible();passwordChanged=true;
 stage='password revocation check';assert.equal(await (await other.request.get(origin+'/api/auth/get-session')).json(),null);
 stage='old password denial';await pause(11000);assert.equal((await login(other,password)).status(),401);report.checks.push('password_changed_old_password_rejected_other_session_revoked');
 stage='authenticator setup';const panel=page.getByRole('region',{name:'Two-factor authentication',exact:true});
 await panel.getByLabel('Password for security changes').fill(updated);await panel.getByRole('button',{name:'Set up authenticator app',exact:true}).click();
 await expect(panel.getByRole('img',{name:'Scan this QR code with your authenticator app'})).toBeVisible();
 await panel.getByText('Enter a setup key manually',{exact:true}).click();
 const secret=await panel.getByLabel('Authenticator setup key').inputValue();
 const otp=createOTP(new TextDecoder().decode(base32.decode(secret)));
 const codes=await panel.getByRole('list',{name:'Recovery codes',exact:true}).getByRole('listitem').allTextContents();assert.equal(codes.length,10);
 await panel.getByRole('checkbox',{name:'I saved these recovery codes somewhere secure.'}).check();
 await panel.getByLabel('Confirm authenticator code').fill(await otp.totp());await panel.getByRole('button',{name:'Enable two-factor authentication',exact:true}).click();
 await expect(panel.getByText('Enabled · authenticator app',{exact:true})).toBeVisible();report.checks.push('authenticator_enabled');
 stage='gated login';await pause(11000);const challenge=await login(other,updated);assert.equal(challenge.status(),200);assert.equal((await challenge.json()).twoFactorRedirect,true);
 assert.equal((await other.request.get(origin+'/api/v1/businesses')).status(),401);report.checks.push('password_alone_denied');
 const verified=await other.request.post(origin+'/api/auth/two-factor/verify-totp',{headers:{origin},data:{code:await otp.totp()}});assert.equal(verified.status(),200);
 assert.equal((await other.request.get(origin+'/api/v1/businesses')).status(),200);report.checks.push('authenticator_login');
 await other.request.post(origin+'/api/auth/sign-out',{headers:{origin},data:{}});
 stage='recovery login';assert.equal((await login(other,updated)).status(),200);
 assert.equal((await other.request.post(origin+'/api/auth/two-factor/verify-backup-code',{headers:{origin},data:{code:codes[0]}})).status(),200);
 assert.equal((await other.request.get(origin+'/api/v1/businesses')).status(),200);report.checks.push('recovery_login');
 stage='disable authenticator';await panel.getByLabel('Password for security changes').fill(updated);await panel.getByRole('checkbox',{name:/I understand replacing codes/}).check();
 await panel.getByRole('button',{name:'Disable two-factor authentication',exact:true}).click();await expect(panel.getByText('Not enabled',{exact:true})).toBeVisible();report.checks.push('authenticator_disabled');
 stage='accessibility';assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations.map(v=>v.id),[]);report.checks.push('desktop_mobile_accessibility');
 await page.screenshot({path:'work/browser/railway-profile-mobile.png',fullPage:true});
 // Restore the fixture's known identity/password so guarded cleanup is repeatable.
 stage='restore fixture';await page.getByLabel('Your name',{exact:true}).fill('Internal onboarding acceptance');await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.getByText('Your name is saved.',{exact:true})).toBeVisible();
 await page.getByLabel('Current password',{exact:true}).fill(updated);await page.getByLabel('New password',{exact:true}).fill(password);await page.getByLabel('Confirm new password',{exact:true}).fill(password);await page.getByRole('button',{name:'Change password',exact:true}).click();await expect(page.getByText('Password changed. Other sessions have been signed out.',{exact:true})).toBeVisible();passwordChanged=false;
 report.passed=true;
} catch (e) {report.failed_stage=stage;report.failure_type=e.code??e.name;report.http_failures=failures;process.exitCode=1;}
finally {
 report.fixture_password_changed=passwordChanged;
 writeFileSync('docs/evidence/railway-profile-browser.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));await context.close();await other.close();await browser.close();
}
