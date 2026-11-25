// Copy runtime libraries from node_modules into app/vendor/ and trees/vendor/ (no build step).
// Run after bumping a vendored dependency in package.json: npm run vendor
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  ['jszip/dist/jszip.min.js', 'app/vendor/jszip.min.js'],
  ['leaflet/dist/leaflet.js', 'trees/vendor/leaflet.js'],
  ['leaflet/dist/leaflet.css', 'trees/vendor/leaflet.css'],
];
for (const [from, to] of files) {
  const dest = path.join(here, '..', to);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(path.join(here, '..', 'node_modules', from), dest);
  console.log('vendored', to);
}
