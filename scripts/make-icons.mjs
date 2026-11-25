// Render apps/<app>/icons/icon.svg to the PNG sizes the manifest and iOS need.
// Usage: npm run icons -- <app>   (default: narrator; uses the Playwright Chromium)
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appName = process.argv[2] || 'narrator';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', appName, 'icons');
const svg = await readFile(path.join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, file, { maskable = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need a full-bleed background and the artwork inside the 80% safe zone.
  const inner = maskable ? Math.round(size * 0.8) : size;
  const html = `<html><body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:${maskable ? '#1b1f2a' : 'transparent'}">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`;
  await page.setContent(html);
  await page.screenshot({ path: path.join(dir, file), omitBackground: !maskable });
  console.log('wrote', file);
}

await render(180, 'icon-180.png', { maskable: true }); // iOS doesn't do transparency
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', { maskable: true });
await browser.close();
