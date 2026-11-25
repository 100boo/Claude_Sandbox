// Every app listed on the launcher must be a self-contained, installable app in its own folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps');
const registry = JSON.parse(await readFile(path.join(appsDir, 'apps.json'), 'utf8'));
const exists = (p) => access(p).then(() => true, () => false);

test('registry entries are well-formed and unique', () => {
  assert.ok(registry.length > 0);
  const ids = registry.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate app id');
  for (const a of registry) {
    assert.match(a.id, /^[a-z0-9-]+$/, `bad id: ${a.id}`);
    for (const k of ['name', 'description', 'icon']) assert.ok(a[k], `${a.id} is missing ${k}`);
  }
});

test('cache prefixes never overlap (all apps share one Cache Storage)', () => {
  const prefixes = registry.filter((a) => a.cachePrefix).map((a) => a.cachePrefix);
  for (const p of prefixes) {
    for (const q of prefixes) if (p !== q) assert.ok(!q.startsWith(p), `${p} overlaps ${q}`);
    // apps/sw.js deletes the old root Narrator caches (narrator-<digit>…); stay clear of that.
    assert.ok(!/^narrator-\d/.test(p), `${p} collides with the root cleanup worker`);
  }
});

test('every app folder is listed on the launcher', async () => {
  const dirs = (await readdir(appsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(dirs.sort(), registry.map((a) => a.id).sort());
});

for (const app of registry) {
  test(`${app.id}: installable on its own path`, async () => {
    const dir = path.join(appsDir, app.id);
    assert.ok(await exists(path.join(dir, 'index.html')), 'index.html');
    assert.ok(await exists(path.join(appsDir, app.icon)), `icon ${app.icon}`);

    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.match(html, /rel="apple-touch-icon"/, 'iPhone home-screen icon');
    assert.match(html, /apple-mobile-web-app-title/, 'iPhone home-screen name');

    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.webmanifest'), 'utf8'));
    // Relative scope/start_url keep each app (and its service worker) inside its own folder.
    assert.equal(manifest.scope, './');
    assert.equal(manifest.start_url, './');
    for (const icon of manifest.icons) assert.ok(await exists(path.join(dir, icon.src)), `manifest icon ${icon.src}`);

    if (await exists(path.join(dir, 'sw.js'))) {
      const sw = await readFile(path.join(dir, 'sw.js'), 'utf8');
      assert.ok(app.cachePrefix, 'apps with a service worker must declare cachePrefix in apps.json');
      assert.ok(sw.includes(`'${app.cachePrefix}'`), `sw.js must name its caches with '${app.cachePrefix}'`);
      // Deleting caches is only safe when filtered to this app's own prefix.
      if (/caches\.delete\(/.test(sw)) assert.match(sw, /startsWith\(/, 'sw.js deletes caches without filtering by its prefix');
    }
  });
}
