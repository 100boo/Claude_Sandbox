// End-to-end for Grove (trees/): phone-sized Chromium with a faked GPS fix.
// Map tiles are stubbed so the test never touches the network.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createServer } from '../../scripts/serve.mjs';
import { withExif } from '../helpers/exif.mjs';

const HERE = { latitude: 46.5197, longitude: 6.6323, accuracy: 8 };
// 1x1 transparent PNG
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let server, base, browser, context, page;

before(async () => {
  server = createServer('trees');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(async () => {
  context = await browser.newContext({
    ...devices['Pixel 7'],
    serviceWorkers: 'block',
    geolocation: HERE,
    permissions: ['geolocation'],
    acceptDownloads: true,
  });
  await context.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: TILE, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
  page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.evaluate(() => window.Grove.ready);
});
afterEach(async () => { await context?.close(); });

/** A real JPEG drawn by the browser, so decoding and resizing are exercised. */
const makeJpeg = (color = '#3a7d44') => page.evaluate(async (c) => {
  const cv = document.createElement('canvas');
  cv.width = 800; cv.height = 600;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = c; ctx.fillRect(0, 0, 800, 600);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}, color).then((a) => Buffer.from(a));

async function logTree({ species = '', notes = '', photo = true, exif } = {}) {
  const before = await page.evaluate(() => window.Grove.state.entries.length);
  await page.locator('#logBtn').click();
  if (photo) {
    let buf = await makeJpeg();
    if (exif) buf = withExif(buf, exif);
    await page.setInputFiles('#photoInput', { name: 'tree.jpg', mimeType: 'image/jpeg', buffer: buf });
    await page.locator('#photoStrip img').first().waitFor();
  }
  if (species) await page.fill('#speciesInput', species);
  if (notes) await page.fill('#notesInput', notes);
  await page.locator('#saveBtn:not([disabled])').waitFor();
  await page.locator('#saveBtn').click();
  // The toast from an earlier save may still be up, so wait for the new entry itself.
  await page.waitForFunction((n) => window.Grove.state.entries.length > n, before);
}

const entries = () => page.evaluate(() => window.Grove.state.entries.map(({ photos, ...e }) => ({ ...e, nPhotos: photos.length })));

test('log a tree with a photo at the current location', async () => {
  assert.equal(await page.locator('#stats').innerText(), 'Nothing logged yet');
  await page.locator('#logBtn').click();
  await page.locator('#locText', { hasText: '46.51970°N 6.63230°E ±8 m · from your location' }).waitFor();
  await page.locator('[data-close]').first().click();

  await logTree({ species: 'Copper beech', notes: 'Huge one by the lake' });
  const [e] = await entries();
  assert.equal(e.species, 'Copper beech');
  assert.equal(e.nPhotos, 1);
  assert.equal(e.locSource, 'device');
  assert.ok(Math.abs(e.lat - HERE.latitude) < 1e-6 && Math.abs(e.lng - HERE.longitude) < 1e-6);
  assert.equal(await page.locator('.pin-photo').count(), 1);
  assert.equal(await page.locator('#stats').innerText(), '1 tree · 1 species · 1 place');

  // Stored photo is resized JPEG; thumbnail is small.
  const sizes = await page.evaluate(async () => {
    const e = window.Grove.state.entries[0];
    const full = await GroveDB.getPhoto(e.photos[0].id);
    const dims = async (b) => { const i = await createImageBitmap(b); return [i.width, i.height]; };
    return { full: await dims(full), thumb: await dims(e.photos[0].thumb), type: full.type };
  });
  assert.deepEqual(sizes.full, [800, 600]);
  assert.deepEqual(sizes.thumb, [320, 240]);
  assert.equal(sizes.type, 'image/jpeg');

  // Tap the pin to see details.
  await page.locator('.pin-photo').click();
  await page.locator('#detailTitle', { hasText: 'Copper beech' }).waitFor();
  assert.match(await page.locator('#detailNotes').innerText(), /Huge one by the lake/);
});

test('entries survive a reload and show in the list', async () => {
  await logTree({ species: 'Oak' });
  await logTree({ species: 'Birch', photo: false });
  await page.reload();
  await page.evaluate(() => window.Grove.ready);
  assert.equal((await entries()).length, 2);
  assert.equal(await page.locator('#stats').innerText(), '2 trees · 2 species · 1 place');
  await page.locator('#listBtn').click();
  await page.locator('.entry', { hasText: 'Oak' }).waitFor();
  assert.equal(await page.locator('.entry').count(), 2);
  await page.fill('#filterInput', 'bir');
  assert.equal(await page.locator('.entry').count(), 1);
  await page.locator('.entry', { hasText: 'Birch' }).click();
  await page.locator('#detailTitle', { hasText: 'Birch' }).waitFor();
});

test('a photo with GPS in it sets the location and date', async () => {
  const takenAt = new Date(2025, 8, 3, 14, 0, 0).getTime();
  await logTree({ species: 'Ginkgo', exif: { lat: 35.0116, lng: 135.7681, takenAt } });
  const [e] = await entries();
  assert.equal(e.locSource, 'photo');
  assert.ok(Math.abs(e.lat - 35.0116) < 1e-4 && Math.abs(e.lng - 135.7681) < 1e-4);
  assert.equal(e.createdAt, takenAt);
});

test('pick the location on the map', async () => {
  await page.locator('#logBtn').click();
  await page.locator('#locText', { hasText: 'from your location' }).waitFor();
  await page.locator('#locPickBtn').click();
  await page.locator('#pickBanner').waitFor();
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2);
  await page.locator('#locText', { hasText: 'from the map' }).waitFor();
  await page.fill('#speciesInput', 'Maple');
  await page.locator('#saveBtn').click();
  await page.locator('#toast', { hasText: 'Saved' }).waitFor();
  const [e] = await entries();
  assert.equal(e.locSource, 'map');
  assert.equal(e.species, 'Maple');
});

test('edit and delete an entry', async () => {
  await logTree({ species: 'Elm' });
  await page.locator('.pin-photo').click();
  await page.locator('#editBtn').click();
  await page.locator('#photoStrip img').waitFor();
  await page.locator('.thumb-x').click();
  await page.fill('#speciesInput', 'Wych elm');
  await page.locator('#saveBtn').click();
  await page.locator('#toast', { hasText: 'Updated' }).waitFor();
  let [e] = await entries();
  assert.equal(e.species, 'Wych elm');
  assert.equal(e.nPhotos, 0);
  assert.equal(await page.evaluate(async () => {
    const db = await GroveDB.open();
    return new Promise((r) => { const q = db.transaction('photos').objectStore('photos').count(); q.onsuccess = () => r(q.result); });
  }), 0, 'removed photo is deleted from storage');

  await page.locator('.pin-dot').click();
  await page.locator('#deleteBtn').click();
  await page.locator('#toast', { hasText: 'Deleted' }).waitFor();
  assert.equal((await entries()).length, 0);
  assert.equal(await page.locator('.leaflet-marker-icon').count(), 0);
});

test('export a backup and import it back', async () => {
  await logTree({ species: 'Yew', notes: 'Churchyard' });
  await page.locator('#menuBtn').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
  const backup = await readFile(await download.path());
  const data = JSON.parse(backup);
  assert.equal(data.app, 'grove');
  assert.equal(data.entries[0].species, 'Yew');
  assert.match(data.entries[0].photos[0].full, /^data:image\/jpeg;base64,/);

  await page.evaluate(async () => {
    for (const e of window.Grove.state.entries) await GroveDB.deleteEntry(e.id);
    await window.Grove.reload();
  });
  assert.equal((await entries()).length, 0);

  await page.setInputFiles('#importInput', { name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await page.locator('#toast', { hasText: 'Imported 1 entry' }).waitFor();
  const [e] = await entries();
  assert.equal(e.notes, 'Churchyard');
  assert.equal(e.nPhotos, 1);

  await page.setInputFiles('#importInput', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await page.locator('#toast', { hasText: "isn't a Grove backup" }).waitFor();
});

test('fog layer can be turned off and the setting sticks', async () => {
  assert.equal(await page.locator('canvas.fog-layer').count(), 1);
  await page.locator('#menuBtn').click();
  await page.locator('#fogToggle').uncheck();
  assert.equal(await page.locator('canvas.fog-layer').count(), 0);
  await page.reload();
  await page.evaluate(() => window.Grove.ready);
  assert.equal(await page.locator('canvas.fog-layer').count(), 0);
});

test('works offline once installed', async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'allow' });
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: TILE, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
  const p = await ctx.newPage();
  await p.goto(base);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await p.reload();
  await p.evaluate(() => window.Grove.ready);
  assert.equal(await p.locator('h1').innerText(), 'Grove');
  await ctx.close();
});
