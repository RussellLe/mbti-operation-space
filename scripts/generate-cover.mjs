/**
 * 生成逐玉图鉴封面 PNG
 * 用法: node scripts/generate-cover.mjs
 */
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

async function main() {
  const htmlPath = resolve(__dirname, 'temp-posters/逐玉封面.html');
  const outputPath = resolve(ROOT, 'images/逐玉图文/逐玉封面.png');

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 580, height: 1040 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const poster = await page.$('.poster-container');
  if (!poster) {
    console.error('No poster container found');
    await browser.close();
    process.exit(1);
  }

  await poster.screenshot({ path: outputPath, type: 'png' });
  console.log(`Saved: ${outputPath}`);

  await browser.close();
}

main().catch(console.error);
