import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';

const origin = process.env.DESVIO_UI_BASE;
test('creation controls stay usable with motion, keyboard navigation and narrow layouts', {skip: !origin, timeout: 90000}, async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const brand = '11111111-1111-4111-8111-111111111111';
  const business = {id: brand, organization_id: brand, name: 'Courtyard Studio', role: 'owner', has_approved_brand: true};
  const title = 'A complete architectural tour of the courtyard residences and their surrounding gardens';
  let mutations = 0;
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let data = {};
    if (req.method() !== 'GET' && !path.endsWith('/initialize')) mutations++;
    if (path.endsWith('/get-session')) data = {user: {id: 'reviewer', name: 'Maya', emailVerified: true}};
    else if (path === '/api/v1/businesses') data = {businesses: [business]};
    else if (path.endsWith('/overview')) data = {counts: {}, upcoming_posts: [], activity: [], recommendations: [], generation_activity: [], campaigns: [], performance: {items: [], posts: []}, next_actions: []};
    else if (path.endsWith('/history')) data = {conversations: [{id: '22222222-2222-4222-8222-222222222222', title, updated_at: '2026-11-08T00:00:00Z'}]};
    else if (path.endsWith('/outbox')) data = {request: null};
    else if (path.endsWith('/generation-notifications')) data = {notifications: []};
    else if (path.endsWith('/prompt-suggestions')) data = {context: 'Residential real estate', preference_key: 'reviewer-brand', dismissed: false};
    await route.fulfill({json: data});
  });
  try {
    await page.goto(`${origin}/b/${brand}/overview`);
    const recent = page.getByRole('button', {name: title, exact: true});
    await expect(recent).toBeVisible();
    assert.deepEqual(await recent.evaluate(el => ({align: getComputedStyle(el).textAlign, overflow: getComputedStyle(el).textOverflow})), {align: 'left', overflow: 'ellipsis'});
    await page.goto(`${origin}/b/${brand}/create`);
    const post = page.locator('.chat-start-card').first();
    await expect(post).toBeVisible();
    const gap = await page.evaluate(() => document.querySelector('.chat-start-card').getBoundingClientRect().top - document.querySelector('.create-chat-panel>header').getBoundingClientRect().bottom);
    assert(gap >= 12, 'The first card needs clearance below the header');
    await post.hover(); await page.waitForTimeout(210);
    assert.notEqual(await post.evaluate(el => getComputedStyle(el).transform), 'none');
    await page.emulateMedia({reducedMotion: 'reduce'});
    assert.equal(await post.evaluate(el => getComputedStyle(el).transform), 'none');
    const history = page.getByRole('button', {name: 'Conversation history', exact: true});
    await history.focus(); await history.press('Enter');
    const dialog = page.getByRole('dialog', {name: 'Conversation history'});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox')).toBeFocused();
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0); await expect(history).toBeFocused();
    await page.emulateMedia({reducedMotion: 'no-preference'});
    await history.press('Enter'); await expect(dialog).toBeVisible();
    assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), 'desvio-surface-in');
    await page.keyboard.press('Escape');
    for (const width of [390, 320]) {
      await page.setViewportSize({width, height: 844});
      await expect(page.getByRole('textbox', {name: 'Message Desvio'})).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await history.click(); await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width);
      await page.keyboard.press('Escape');
    }
    assert.equal(mutations, 0, 'Design interactions must not submit content');
    if (process.env.DESVIO_EXPECT_PRODUCTION === '1') await expect(page.getByRole('button', {name: 'Start feedback mode'})).toHaveCount(0);
  } finally {
    await page.unrouteAll({behavior: 'ignoreErrors'}); await browser.close();
  }
});
