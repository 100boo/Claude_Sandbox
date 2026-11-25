// The launcher at the site root, and the cleanup of the old root-level Narrator install.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { createServer } from '../../scripts/serve.mjs';

let server, base, browser;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('launcher lists apps and opens them', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 15'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  try {
    await page.goto(base);
    const card = page.locator('a.app', { hasText: 'Narrator' });
    await card.waitFor();
    assert.equal(await card.getAttribute('href'), 'narrator/');
    assert.ok(await card.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), 'icon loads');
    await card.click();
    await page.waitForURL(base + 'narrator/');
    await page.locator('h1', { hasText: 'Narrator' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
  }
});

test('root cleanup worker removes the old root install but not current app caches', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(base);
    // Simulate a phone that installed Narrator back when it lived at the root.
    await page.evaluate(async () => {
      await (await caches.open('narrator-0.1.0')).put('/old', new Response('old'));
      await (await caches.open('sandbox/narrator/0.1.1')).put('/new', new Response('new'));
      await navigator.serviceWorker.register('sw.js');
    });
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistrations()).length === 0, null, { timeout: 10000 });
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(!keys.includes('narrator-0.1.0'), 'old cache removed');
    assert.ok(keys.includes('sandbox/narrator/0.1.1'), 'current app cache kept');
  } finally {
    await ctx.close();
  }
});
