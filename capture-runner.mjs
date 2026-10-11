import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { startForCapture } from '/home/runner/work/_temp/omgithub-runtime/scripts/capture-start.mjs';

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const require = createRequire(join(runtime, 'package.json'));
const { chromium } = require('playwright');

const config = JSON.parse(readFileSync(join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json'), 'utf8'));
if (process.platform === 'linux') {
  try { process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim(); } catch {}
}

const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
if (!url || !output) {
  console.error('Set CAPTURE_URL and CAPTURE_DIR.');
  process.exit(1);
}
mkdirSync(output, { recursive: true });

const transient = (error) => { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { exitCode: 75 }); };
let browser;
try {
  browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 }).catch(transient);
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }).catch(transient);
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => console.error(error.message));
    // Open the exact URL (no rewriting).
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(transient);
    if (!response?.ok()) {
      const status = response?.status?.() ?? 0;
      const retryable = !response || [408, 429, 500, 502, 503, 504].includes(status);
      throw Object.assign(new Error(`HTTP ${status || 'no-response'} loading preview`), { exitCode: retryable ? 75 : 1 });
    }
    // Wait for rendered content.
    await page.locator(process.env.CAPTURE_READY_SELECTOR || 'body').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    // Canvas must exist and have nonzero size (rendering defect -> exit 1).
    const canvasOk = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return r.width > 10 && r.height > 10;
    });
    if (!canvasOk) throw Object.assign(new Error('Rendering defect: canvas missing or empty'), { exitCode: 1 });
    const start = await startForCapture(page, {
      enabled: process.env.CAPTURE_AUTO_START !== 'false',
      selector: process.env.CAPTURE_START_SELECTOR || ''
    });
    console.log(`Capture ${name}: auto-start ${start.clicked ? 'clicked' : start.reason}`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(output, `final-${name}.png`), timeout: 30000 }).catch((error) => {
      if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error);
      throw error;
    });
    await page.close();
  }
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
} finally {
  await browser?.close().catch((error) => { console.error(error); process.exitCode ||= 75; });
}
