// End-to-end: drive the real app in Chromium at phone size with a fake
// speechSynthesis that records what would be spoken.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { createServer } from '../../scripts/serve.mjs';
import { makeEpub } from '../helpers/epub.mjs';

let server, base, browser, context, page;

const FAKE_TTS = () => {
  window.__spoken = [];
  window.__ttsDelay = 15;
  let current = null;
  const fire = (u, type, extra) => { const h = u['on' + type]; if (h) h(Object.assign({ type, utterance: u }, extra)); };
  const synth = {
    speaking: false, pending: false, paused: false,
    speak(u) {
      current = u;
      synth.speaking = true;
      setTimeout(() => {
        if (current !== u) return;
        fire(u, 'start');
        window.__spoken.push(u.text);
        setTimeout(() => {
          if (current !== u) return;
          current = null;
          synth.speaking = false;
          fire(u, 'end');
        }, window.__ttsDelay);
      }, 1);
    },
    cancel() {
      const u = current;
      current = null;
      synth.speaking = false;
      if (u) fire(u, 'error', { error: 'interrupted' });
    },
    pause() {}, resume() {},
    getVoices: () => [{ voiceURI: 'test-voice', name: 'Test Voice', lang: 'en-US', localService: true, default: true }],
    addEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
};

const story = (n, extra = 0) => ({
  title: 'The Wandering Inn Test',
  author: 'Tester',
  chapters: Array.from({ length: n + extra }, (_, i) => ({
    title: `Chapter ${i + 1}`,
    paras: [`Chapter ${i + 1} paragraph one.`, `Chapter ${i + 1} paragraph two.`, `Chapter ${i + 1} paragraph three.`],
  })),
});

async function importEpub(spec, name = 'story.epub') {
  await page.setInputFiles('#fileInput', { name, mimeType: 'application/epub+zip', buffer: await makeEpub(spec) });
  await page.locator('#toast', { hasText: /Added|Updated/ }).waitFor();
}

const spoken = () => page.evaluate(() => window.__spoken);
const waitSpoken = (text) => page.waitForFunction((t) => window.__spoken.includes(t), text, { timeout: 10000 });

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/narrator/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(async () => {
  context = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await context.addInitScript(FAKE_TTS);
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
});
afterEach(async () => { await context?.close(); });

test('import an EPUB and see it in the library', async () => {
  assert.ok(await page.locator('#emptyMsg').isVisible());
  await importEpub(story(3));
  const item = page.locator('.book');
  await assert.doesNotReject(item.waitFor());
  assert.match(await item.innerText(), /The Wandering Inn Test/);
  assert.match(await item.innerText(), /Ch 1 of 3 · 0%/);
  assert.ok(await page.locator('#emptyMsg').isHidden());
});

test('plays chapter title then paragraphs, and rolls into the next chapter', async () => {
  await importEpub(story(2));
  await page.locator('.book').click();
  await page.locator('#playBtn').click();
  await waitSpoken('Chapter 2 paragraph one.');
  const s = await spoken();
  assert.deepEqual(s.slice(0, 5), [
    'Chapter 1',
    'Chapter 1 paragraph one.',
    'Chapter 1 paragraph two.',
    'Chapter 1 paragraph three.',
    'Chapter 2',
  ]);
  assert.match(await page.locator('#chapterBtn').innerText(), /^2\/2 · Chapter 2/);
  // Finishes the book and stops on its own.
  await page.locator('#toast', { hasText: 'finished the book' }).waitFor();
  assert.equal(await page.locator('#playBtn').getAttribute('aria-label'), 'Play');
});

test('remembers position across reloads', async () => {
  await importEpub(story(3));
  await page.locator('.book').click();
  await page.locator('#nextCh').click();
  await page.locator('#nextP').click();
  assert.match(await page.locator('#progText').innerText(), /¶ 2\/3/);
  await page.locator('#backBtn').click();
  await page.locator('.book', { hasText: 'Ch 2 of 3' }).waitFor();
  await page.reload();
  assert.match(await page.locator('.book').innerText(), /Ch 2 of 3/);
  await page.locator('.book').click();
  await page.locator('#chapterBtn', { hasText: /^2\/3/ }).waitFor();
  assert.match(await page.locator('#progText').innerText(), /¶ 2\/3/);
  assert.equal(await page.locator('#reader p.cur').innerText(), 'Chapter 2 paragraph two.');
});

test('re-importing a serial with new chapters updates it and keeps your place', async () => {
  await importEpub(story(2));
  await page.locator('.book').click();
  await page.locator('#nextCh').click();
  await page.locator('#backBtn').click();
  await importEpub(story(2, 3), 'story-updated.epub');
  assert.match(await page.locator('#toast').innerText(), /Updated .* \(\+3 new chapters\)/);
  assert.equal(await page.locator('.book').count(), 1);
  assert.match(await page.locator('.book').innerText(), /Ch 2 of 5/);
});

test('chapter search jumps by number, title and text', async () => {
  const spec = story(12);
  spec.chapters[8].paras.push('The lighthouse keeper had a secret nobody guessed.');
  await importEpub(spec);
  await page.locator('.book').click();

  await page.locator('#chapterBtn').click();
  const search = page.locator('#chapterSearch');
  // By number: "9" puts chapter 9 first.
  await search.fill('9');
  await page.locator('#chapterList li').first().filter({ hasText: '9. Chapter 9' }).waitFor();
  await page.locator('#chapterList li').first().click();
  await page.locator('#chapterBtn', { hasText: /^9\/12/ }).waitFor();

  // By text: find a phrase and land on that paragraph.
  await page.locator('#chapterBtn').click();
  assert.equal(await search.inputValue(), '', 'search box resets each time');
  await search.fill('lighthouse keeper');
  const hit = page.locator('#textHits li', { hasText: 'Ch 9' });
  await hit.waitFor();
  assert.equal(await hit.locator('mark').innerText(), 'lighthouse keeper');
  await page.locator('#chapterSheet [data-close]').click();
  await page.locator('#nextCh').click(); // move away first so the jump is real
  await page.locator('#chapterBtn', { hasText: /^10\/12/ }).waitFor();
  await page.locator('#chapterBtn').click();
  await search.fill('lighthouse keeper');
  await page.locator('#textHits li', { hasText: 'Ch 9' }).click();
  await page.locator('#chapterBtn', { hasText: /^9\/12/ }).waitFor();
  assert.equal(await page.locator('#reader p.cur').innerText(), 'The lighthouse keeper had a secret nobody guessed.');

  // No matches.
  await page.locator('#chapterBtn').click();
  await search.fill('zzzqqq');
  await page.locator('#searchEmpty').waitFor();
});

test('tapping a paragraph starts reading from there', async () => {
  await importEpub(story(1));
  await page.locator('.book').click();
  await page.locator('#reader p', { hasText: 'paragraph three' }).click();
  await waitSpoken('Chapter 1 paragraph three.');
  assert.deepEqual(await spoken(), ['Chapter 1 paragraph three.']);
});

test('sleep timer can stop at the end of the chapter', async () => {
  await importEpub(story(3));
  await page.locator('.book').click();
  await page.locator('#sleepBtn').click();
  await page.locator('[data-sleep="chapter"]').click();
  assert.match(await page.locator('#sleepText').innerText(), /end of chapter/);
  await page.locator('#playBtn').click();
  await page.locator('#toast', { hasText: 'end of chapter' }).waitFor();
  const s = await spoken();
  assert.equal(s.at(-1), 'Chapter 1 paragraph three.');
  assert.ok(!s.includes('Chapter 2 paragraph one.'));
  // Next play starts at chapter 2.
  assert.match(await page.locator('#chapterBtn').innerText(), /^2\/3/);
});

test('paste text creates a book', async () => {
  await page.locator('#pasteBtn').click();
  await page.locator('#pasteTitle').fill('Pasted');
  await page.locator('#pasteText').fill('Chapter 1\n\nHello there.\n\nChapter 2\n\nGoodbye.');
  await page.locator('#pasteSave').click();
  await page.locator('#toast', { hasText: 'Added “Pasted” (2 chapters)' }).waitFor();
  assert.match(await page.locator('.book').innerText(), /Pasted/);
});

test('speed button cycles and persists', async () => {
  await importEpub(story(1));
  await page.locator('.book').click();
  await page.locator('#rateBtn').click();
  assert.equal(await page.locator('#rateBtn').innerText(), '1.25×');
  await page.reload();
  assert.equal(await page.evaluate(() => window.Narrator.settings.rate), 1.25);
});

test('delete removes a book', async () => {
  await importEpub(story(1));
  await page.locator('.book .del').click();
  await page.locator('#emptyMsg').waitFor();
  assert.equal(await page.locator('.book').count(), 0);
});

test('bad files show an error instead of crashing', async () => {
  await page.setInputFiles('#fileInput', { name: 'broken.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('PK not really a zip') });
  await page.locator('#toast', { hasText: "Couldn't import broken.epub" }).waitFor();
});

test('works offline once the service worker is installed', async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  await ctx.addInitScript(FAKE_TTS);
  const p = await ctx.newPage();
  try {
    await p.goto(base);
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.reload(); // now controlled by the SW
    await ctx.setOffline(true);
    await p.reload();
    assert.ok(await p.locator('h1', { hasText: 'Narrator' }).isVisible());
    assert.equal(await p.evaluate(() => typeof window.Parsers.parseEpub), 'function');
  } finally {
    await ctx.close();
  }
});
