// Read-only deployment smoke: both pages must use the intended relay origin.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.argv[2], expected = process.argv[3] ?? new URL(base).origin;
const browser = await chromium.launch({ headless: true });
try {
  for (const [pagePath, apiPath] of [['/', '/sessions/lobby'], ['/games/', '/game-rooms']]) {
    const page = await browser.newPage();
    if (process.argv.includes('--stub')) await page.route('**' + apiPath,
      route => route.fulfill({ json: { rooms: [], modes: ['direct', 'hosted'] } }));
    const response = page.waitForResponse(r => new URL(r.url()).pathname === apiPath);
    await page.goto(new URL(pagePath, base).href);
    const result = await response;
    assert.equal(new URL(result.url()).origin, expected, `${pagePath} must use the intended relay`);
    assert.equal(result.status(), 200);
    console.log('PASS', pagePath, '→', expected + apiPath);
    await page.close();
  }
} finally { await browser.close(); }
