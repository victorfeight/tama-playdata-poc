// Real browser + relay + simulated UART. Run through the workspace tsx loader
// so fixtures use the maintained protocol encoder rather than copied crypto.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createChunk } from '../tama-protocol/src/framing.ts';
import { tcpCrypt } from '../tama-protocol/src/tcp-crypto.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [url, output] = process.argv.slice(2);
if (!url || !output) throw new Error('Usage: test-gift-preview-browser.mjs URL OUTPUT');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const pages = [], errors = [];
  for (const nickname of ['Juniper', 'Clover']) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const serial = new EventTarget();
      serial.requestPort = async () => ({
        async open() {
          this.readable = new ReadableStream({ start(c) { window.uartIn = bytes => c.enqueue(new Uint8Array(bytes)); } });
          this.writable = new WritableStream({ write(bytes) { (window.uartOut ??= []).push([...bytes]); } });
        }, async close() {}, getInfo() { return {}; }
      });
      Object.defineProperty(navigator, 'serial', { value: serial });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.locator('#nickname').fill(nickname);
    await page.locator('#connect-serial').click(); pages.push(page);
  }
  const [host, guest] = pages;
  await host.locator('#create-room').click();
  await host.waitForFunction(() => document.querySelector('#active-code').textContent.length === 6);
  await guest.locator('#room-code').fill(await host.locator('#active-code').textContent());
  await guest.locator('#join-room').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll press B');
  // Arbitrary raw two-byte WS/UART frames must not become plaintext gift offers.
  await host.evaluate(() => window.uartIn([0x8b, 0x13]));
  await guest.waitForFunction(() => window.uartOut?.some(a => a.join() === '139,19'));
  assert(!/BIG MEAT/.test(await guest.locator('#ghost-summary').textContent()));
  // Raw garbage intentionally lacks a command boundary. Start a fresh adapter
  // epoch before exercising a valid exchange; never silently repair UART bytes.
  await host.locator('#connect-serial').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’re both here');
  await host.locator('#connect-serial').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll press B');
  await guest.locator('#start-prompt').click();
  await host.waitForFunction(() => document.querySelector('#start-prompt').textContent === 'I’m on Gift screen' && !document.querySelector('#start-prompt').hidden);
  await host.locator('#start-prompt').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B now');
  const send = async (from, to, payload, type = 2) => {
    const nonce = new Uint8Array([3, 1, 4, 1]);
    const chunk = new Uint8Array([...nonce, ...await tcpCrypt(nonce, createChunk(42, type, 0, new Uint8Array(payload)))]);
    await from.evaluate(bytes => window.uartIn(bytes), [...new TextEncoder().encode(`PKT ${payload.length}\r\n`)]);
    await to.evaluate(() => window.uartIn([...new TextEncoder().encode('ACK\r\n')]));
    // Deliberately split nonce and encrypted payload over several serial reads.
    for (let i = 0; i < chunk.length; i += 3) await from.evaluate(bytes => window.uartIn(bytes), [...chunk.slice(i, i + 3)]);
    await to.evaluate(() => window.uartIn([...new TextEncoder().encode('ACK\r\n')]));
  };
  await send(host, guest, [1, 0, 0, 0]);
  await send(host, guest, [0x8b, 0x13]);
  await guest.waitForFunction(() => document.querySelector('#ghost-summary').textContent.includes('Their offer: BIG MEAT'));
  await send(guest, host, [0x8c, 0x13]);
  await host.waitForFunction(() => document.querySelector('#ghost-summary').textContent.includes('Their offer: SMALL MEAT'));
  for (const page of pages) {
    const summary = await page.locator('#ghost-summary').textContent();
    assert(summary.includes('BIG MEAT') && summary.includes('SMALL MEAT'));
    assert(!/complete|saved|received/i.test(summary));
    assert.equal(await page.locator('#next-heading').textContent(), 'Follow your toy');
  }
  await send(host, guest, [0x8b, 0x13]); // Retry retains the same two offers.
  await guest.screenshot({ path: `${output}/gift-offers.png`, fullPage: true });
  await host.locator('#connect-serial').click();
  await guest.waitForFunction(() => !document.querySelector('#ghost-summary').textContent.includes('BIG MEAT'));
  assert(await guest.locator('#room-panel').isVisible());
  await host.locator('#leave-room').click(); await guest.locator('#leave-room').click();
  assert.deepEqual(errors, []);
  const receipt = { passed: true, checks: ['Raw bytes do not invent plaintext offers', 'Fragmented encrypted type2 packets show both correct items', 'No saved/completed claims', 'Duplicate offer remains stable', 'Peer adapter change clears offers without leaving room'], scope: 'Two browsers and local relay; simulated UART, not a completed native trade' };
  await writeFile(`${output}/browser.json`, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} catch (error) {
  const states = [];
  for (const context of browser.contexts()) for (const page of context.pages())
    states.push(await page.evaluate(() => ({ text: document.body.innerText, log: document.querySelector('#byte-log')?.textContent })));
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), states }, null, 2));
  throw error;
} finally { await browser.close(); }
