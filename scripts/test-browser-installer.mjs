import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [url, output] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  await context.addInitScript(() => {
    const serial = new EventTarget();
    serial.requestPort = async () => ({
      async open() {
        window.portOpenCount = (window.portOpenCount ?? 0) + 1;
        let controller, phase = 'download', remaining = 0, sendingHelper = true, current = 0;
        const crc32 = bytes => { let crc = 0xffffffff; for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
        const reply = (seq, detail = 0) => { const b = new Uint8Array(16), v = new DataView(b.buffer); b.set([84,80,82,49]); v.setUint32(4, seq, true); b[9] = detail; v.setUint32(12, crc32(b.subarray(0,12)), true); controller.enqueue(b); };
        this.readable = new ReadableStream({ start(c) { controller = c; window.serialRx = bytes => c.enqueue(new Uint8Array(bytes)); } });
        window.returnToDownload = () => { phase = 'download'; sendingHelper = false; };
        this.writable = new WritableStream({ write(bytes) {
          (window.serialWrites ??= []).push(bytes.length);
          if (window.unplugNextWrite) { window.unplugNextWrite = false; controller.error(new Error('USB disconnected')); return; }
          if (phase === 'download') {
            const text = new TextDecoder().decode(bytes);
            if (text.startsWith('PKT ')) remaining = Number(text.trim().slice(4));
            else remaining -= bytes.length - 16;
            controller.enqueue(new TextEncoder().encode('ACK\r\n'));
            if (remaining === 0) {
              if (sendingHelper) { phase = 'header'; reply(0xfffffffc); }
              else phase = 'game';
            }
          } else if (phase === 'header') { if (bytes.length !== 128) throw new Error('Expected stream header'); phase = 'records'; reply(0xfffffffe); }
          else if (phase === 'records') {
            if (bytes.length === 36) {
              current = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
              reply(current, current % 2 === 0 ? 2 : 0);
              if (current === 247 && current % 2 === 0) reply(0xfffffffd);
            } else if (bytes.length === 4096) { reply(current, 1); if (current === 247) { reply(0xfffffffd); phase = 'ready'; } }
            else throw new Error('Unexpected media body');
          }
        } });
      }, async close() {}, getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x7523 }; }
    });
    Object.defineProperty(navigator, 'serial', { value: serial });
  });
  await context.route('**/sessions', r => r.fulfill({ json: { code: 'ABC123', token: 'browser-test' } }));
  let socket;
  await context.routeWebSocket('**/ws/**', ws => { socket = ws; setTimeout(() => ws.send('peer connected'), 30); });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.locator('#download:not([hidden])').waitFor();
  assert(!(await page.locator('body').textContent()).includes('INSTALL-MUSIC.cmd'));
  assert(!(await page.locator('body').textContent()).includes('Python'));
  await page.locator('#connect').click();
  await page.locator('#install-music:not([disabled])').waitFor();
  await page.screenshot({ path: `${output}/setup-desktop.png`, fullPage: true });
  await page.locator('#install-music').click();
  await page.waitForFunction(() => document.querySelector('#install-status').textContent.startsWith('Music verified.'), null, { timeout: 30000 });
  assert((await page.locator('#install-status').textContent()).includes('Press C'));
  assert((await page.locator('#install-status').textContent()).includes('Download → Download'));
  assert.equal(await page.evaluate(() => window.portOpenCount), 1);
  assert.equal(await page.locator('#device-state').textContent(), 'Connected');
  assert((await page.locator('#log').textContent()).includes('124 sectors written, 124 already matched'));
  checks.push('Verified actual packaged files; helper plus 248-sector music protocol with write/skip responses; explicit C/Download instruction; no ZIP/CLI prerequisite');
  await page.evaluate(() => window.returnToDownload()); await page.locator('#send-game').click();
  await page.waitForFunction(() => document.querySelector('#install-status').textContent.startsWith('Game received.'));
  assert.equal(await page.evaluate(() => window.portOpenCount), 1);
  await page.locator('#create').click(); await page.locator('#room:not([hidden])').waitFor();
  socket.send(Buffer.from([4,5,6]));
  await page.waitForFunction(() => window.serialWrites.at(-1) === 3);
  checks.push('Game send and multiplayer bridge share the same open adapter');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/game-ready-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  checks.push('390px layout without overflow or browser errors');
  await page.locator('#leave').click();
  await page.locator('#connect').click();
  await page.evaluate(() => { window.returnToDownload(); window.unplugNextWrite = true; });
  const beforeUnplug = await page.evaluate(() => window.serialWrites.length);
  await page.locator('#send-game').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Adapter connection lost') &&
    document.querySelector('#device-state').textContent === 'Not connected');
  assert.equal(await page.evaluate(() => window.serialWrites.length), beforeUnplug + 1);
  assert(await page.locator('#send-game').isDisabled());
  await page.locator('#connect').click();
  await page.evaluate(() => window.returnToDownload());
  await page.locator('#send-game').click();
  await page.waitForFunction(() => document.querySelector('#install-status').textContent.startsWith('Game received.'));
  assert.equal(await page.evaluate(() => window.portOpenCount), 3);
  assert.deepEqual(errors, []);
  checks.push('Unplug stops transfer immediately, clears connected state and allows a fresh connection/game send without automatic write retries');
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: true, checks, scope: 'Actual packaged assets and browser code; simulated UART responses and room' }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  if (page) {
    const state = await page.evaluate(() => ({ status: document.querySelector('#install-status')?.textContent,
      log: document.querySelector('#log')?.textContent, writes: window.serialWrites }));
    await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), errors, state }, null, 2));
    console.error(JSON.stringify(state));
  }
  throw error;
} finally { await browser.close(); }
