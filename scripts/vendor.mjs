// Copy runtime libraries from node_modules into each app's vendor/ folder (the app has no build step).
// Run after bumping a vendored dependency in package.json: npm run vendor
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// [app, file in node_modules, name in apps/<app>/vendor/]
const files = [['narrator', 'jszip/dist/jszip.min.js', 'jszip.min.js']];
for (const [app, from, to] of files) {
  const out = path.join(here, '..', 'apps', app, 'vendor');
  await mkdir(out, { recursive: true });
  await copyFile(path.join(here, '..', 'node_modules', from), path.join(out, to));
  console.log('vendored', `${app}/vendor/${to}`);
}
