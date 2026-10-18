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
        const reply = (seq, detail = 0, status = 0) => { const b = new Uint8Array(16), v = new DataView(b.buffer); b.set([84,80,82,49]); v.setUint32(4, seq, true); b[8] = status; b[9] = detail; v.setUint32(12, crc32(b.subarray(0,12)), true); controller.enqueue(b); };
        this.readable = new ReadableStream({ start(c) { controller = c; window.serialRx = bytes => c.enqueue(new Uint8Array(bytes)); } });
        window.returnToDownload = (operation = 'game') => { phase = 'download'; sendingHelper = operation !== 'game'; window.helperMode = operation; };
        this.writable = new WritableStream({ write(bytes) {
          (window.serialWrites ??= []).push(bytes.length);
          if (window.unplugNextWrite) { window.unplugNextWrite = false; controller.error(new Error('USB disconnected')); return; }
          if (phase === 'download') {
            const text = new TextDecoder().decode(bytes);
            if (text.startsWith('PKT ')) remaining = Number(text.trim().slice(4));
            else remaining -= bytes.length - 16;
            controller.enqueue(new TextEncoder().encode('ACK\r\n'));
            if (remaining === 0) {
              if (sendingHelper) {
                if (window.helperMode === 'remove') { phase = 'remove'; reply(0xfffffffc, 3, window.refuseMusicRemoval ? 3 : 0); }
                else { phase = 'header'; reply(0xfffffffc, 1); }
              }
              else phase = 'game';
            }
          } else if (phase === 'remove') {
            if (window.refuseMusicRemoval) throw new Error('Must not send erase confirmation after refusal');
            if (bytes.length !== 16 || new TextDecoder().decode(bytes.subarray(0, 8)) !== 'PPCLR001') throw new Error('Invalid remove command');
            reply(0xfffffffe, 3);
            for (let sector = 0; sector < 256; sector++) reply(sector, sector < 248 ? 1 : 2);
            reply(0xfffffffd, 3); phase = 'ready';
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
  await context.route('**/game-rooms', r => r.fulfill({ json: r.request().method() === 'GET'
    ? { rooms: [], modes: ['direct', 'hosted'] } : { code: 'ABC123', token: 'a'.repeat(64), memberId: 'self', game: 'pocket-puzzle', mode: 'direct' } }));
  await context.route('**/game-rooms/*/leave', r => r.fulfill({ json: { ok: true } }));
  let socket;
  await context.routeWebSocket('**/game-ws/**', ws => { socket = ws; setTimeout(() => ws.send(JSON.stringify({
    type: 'game-room', code: 'ABC123', game: 'pocket-puzzle', mode: 'direct', owner: 'self', visibility: 'private', capacity: 2, canStart: false,
    members: [{ id: 'self', nickname: 'Fern', connected: true, adapter: false, toyReady: false, ready: false }] })), 30); });
  page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => document.querySelector('#game-download-status').textContent === '');
  assert.equal(await page.locator('#payload-link').count(), 0);
  assert(!(await page.locator('body').textContent()).includes('INSTALL-MUSIC.cmd'));
  assert(!(await page.locator('body').textContent()).includes('Python'));
  assert(!(await page.locator('#remove-music').isVisible()));
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
  const beforeCancel = await page.evaluate(() => window.serialWrites.length);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#remove-music').click();
  assert.equal(await page.evaluate(() => window.serialWrites.length), beforeCancel);
  await page.evaluate(() => window.returnToDownload('remove'));
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#remove-music').click();
  await page.waitForFunction(() => document.querySelector('#install-status').textContent.startsWith('Music removed.'));
  assert((await page.locator('#log').textContent()).includes('248 sectors erased, 8 already empty'));
  assert((await page.locator('#install-status').textContent()).includes('Press C'));
  assert.equal(await page.evaluate(() => window.portOpenCount), 1);
  checks.push('Remove music requires connection and confirmation; cancel sends nothing; verified 256-sector completion shares adapter and tells user to press C');
  await page.evaluate(() => { window.returnToDownload('remove'); window.refuseMusicRemoval = true; });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#remove-music').click();
  await page.waitForFunction(() => document.querySelector('#install-status').textContent.includes('Nothing was erased'));
  assert.equal(await page.evaluate(() => window.serialWrites.at(-1)), 4108); // Last helper Download chunk, no removal command.
  await page.evaluate(() => { window.refuseMusicRemoval = false; });
  checks.push('Occupied music space refuses confirmation and offers C return without erasing');
  await page.evaluate(() => window.returnToDownload()); await page.locator('#send-game').click();
  await page.waitForFunction(() => document.querySelector('#install-status').textContent.startsWith('Game received.'));
  assert.equal(await page.evaluate(() => window.portOpenCount), 1);
  await page.locator('#group-nickname').fill('Fern');
  await page.locator('#group-create').click(); await page.locator('#group-current:not([hidden])').waitFor();
  await page.waitForFunction(() => document.querySelector('#group-players').textContent.includes('Fern'));
  assert(!(await page.locator('#remove-music').isVisible()));
  socket.send(Buffer.from([4,5,6]));
  await page.waitForFunction(() => window.serialWrites.at(-1) === 3);
  checks.push('Game send and multiplayer bridge share the same open adapter');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/game-ready-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  checks.push('390px layout without overflow or browser errors');
  await page.locator('#group-leave').click();
  await page.locator('#group-entry:not([hidden])').waitFor();
  assert.equal(await page.locator('#device-state').textContent(), 'Connected');
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
  assert.equal(await page.evaluate(() => window.portOpenCount), 2);
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
