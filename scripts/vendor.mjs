// Copy runtime libraries from node_modules into app/vendor/ (the app has no build step).
// Run after bumping a vendored dependency in package.json: npm run vendor
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'app', 'vendor');
await mkdir(out, { recursive: true });
const files = [['jszip/dist/jszip.min.js', 'jszip.min.js']];
for (const [from, to] of files) {
  await copyFile(path.join(here, '..', 'node_modules', from), path.join(out, to));
  console.log('vendored', to);
}
