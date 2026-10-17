// Real form controls; mock room APIs to prove validation precedes requests.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  for (const game of [false, true]) {
    const page = await browser.newPage(); let posts = 0;
    if (game) await page.addInitScript(() => Object.defineProperty(navigator, 'serial', { value: {
      requestPort: async () => ({
        async open() { this.readable = new ReadableStream(); this.writable = new WritableStream(); },
        close: async () => {}, getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 })
      })
    } }));
    await page.route('**/*', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path.startsWith('/sessions/') || path.startsWith('/game-rooms')) {
        if (request.method() === 'POST') posts++;
        return route.fulfill({ status: request.method() === 'POST' ? 400 : 200,
          contentType: 'application/json', body: JSON.stringify(request.method() === 'POST' ? { message: 'Test request received' } : { rooms: [] }) });
      }
      return route.continue();
    });
    await page.goto(process.argv[2] + (game ? '/games/' : '/'));
    const input = page.locator(game ? '#group-nickname' : '#nickname');
    const create = page.locator(game ? '#group-create' : '#create-room');
    await create.waitFor({ state: 'visible' });
    if (game) {
      assert(await page.locator('#install-actions').isHidden());
      await page.locator('#connect').click();
      await page.locator('#install-actions:not([hidden])').waitFor();
      await page.locator('#connect').click();
      await page.waitForFunction(() => document.querySelector('#install-actions').hidden);
    }
    await input.fill('fuck123'); await create.click();
    await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-invalid') === 'true', game ? '#group-nickname' : '#nickname');
    assert.equal(posts, 0);
    assert((await input.evaluate(e => e.validationMessage)).includes('without offensive words'));
    await input.fill('Cassie');
    assert.equal(await input.getAttribute('aria-invalid'), null);
    await create.click();
    await page.waitForFunction(id => document.querySelector(id).textContent.includes('Test request received'), game ? '#group-status' : '#lobby-status');
    assert.equal(posts, 1);
    await input.fill('shit42');
    await page.locator(game ? '#group-code-input' : '#room-code').fill('ABC123');
    if (game) await page.locator('#group-join').click();
    else await page.locator('#join-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(id => document.querySelector(id).getAttribute('aria-invalid') === 'true', game ? '#group-nickname' : '#nickname');
    assert.equal(posts, 1);
    console.log('PASS', game ? 'Games' : 'Playdate', 'create/join blocked before HTTP; editing clears error; ordinary nickname accepted');
    await page.close();
  }
} finally { await browser.close(); }
