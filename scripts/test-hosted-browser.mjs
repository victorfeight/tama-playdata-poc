// Two actual browsers -> actual HTTP/WS service -> real SDK C client code.
// Serial hardware is simulated. Scripted top-outs test match lifecycle.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [url, output, binary, game = 'blocks'] = process.argv.slice(2);
assert(url && output && binary, 'Usage: URL OUTPUT NATIVE_CLIENT_BINARY [GAME]');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const native = spawn(binary, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = []; let chain = Promise.resolve(), states = [], stopped = false, tickTask;
const pages = [], errors = [], checks = [];
const began = performance.now(), now = () => Math.floor(performance.now() - began);
createInterface({ input: native.stdout }).on('line', line => { const receive = waiting.shift(); assert(receive); receive(JSON.parse(line)); });
function command(line) {
  const task = chain.then(() => new Promise(resolve => { waiting.push(resolve); native.stdin.write(line + '\n'); }));
  chain = task.catch(() => {});
  return task.then(async result => {
    states = result;
    await Promise.all(result.map(async (state, i) => {
      if (state.wire && pages[i] && !pages[i].isClosed()) await pages[i].evaluate(bytes => window.nativeRx?.(bytes), [...Buffer.from(state.wire, 'hex')]);
    })); return result;
  });
}
try {
  await command(`I 2 ${now()}`);
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    const page = await context.newPage(); pages.push(page);
    await page.exposeFunction('nativeWrite', bytes => command(`R ${index} ${now()} ${Buffer.from(bytes).toString('hex')}`));
    await context.addInitScript(() => {
      const serial = new EventTarget();
      serial.requestPort = async () => ({
        async open() {
          this.readable = new ReadableStream({ start(controller) { window.nativeRx = bytes => controller.enqueue(new Uint8Array(bytes)); }, cancel() { window.nativeRx = undefined; } });
          this.writable = new WritableStream({ write(bytes) { return window.nativeWrite([...bytes]); } });
        }, async close() { window.nativeRx = undefined; }, getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x7523 }; }
      }); Object.defineProperty(navigator, 'serial', { value: serial });
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${url}?game=${game}&mode=hosted`);
    await page.locator('#group-room:not([hidden])').waitFor();
    await page.locator('#group-nickname').fill(index ? 'Willow' : 'Fern');
    await page.locator('#connect').click();
  }
  tickTask = (async () => { while (!stopped) { await command(`T ${now()}`); await new Promise(r => setTimeout(r, 15)); } })();
  const [host, guest] = pages;
  await host.locator('#group-public').check(); await host.locator('#group-create').click();
  await host.locator('#group-current:not([hidden])').waitFor();
  const code = await host.locator('#group-code').textContent();
  await guest.locator('#group-code-input').fill(code); await guest.locator('#group-join').click();
  await guest.locator('#group-current:not([hidden])').waitFor();
  for (const page of pages) await page.waitForFunction(() => document.querySelector('#group-action').textContent === 'I’m ready' && !document.querySelector('#group-action').disabled);
  for (const page of pages) {
    assert(await page.locator('#install-actions').isHidden(), 'Game setup should be tucked away in an active room');
    assert.equal(await page.locator('#group-status').textContent(), '');
  }
  checks.push('Two real browsers, distinct room credentials, real native toy HELLO/READY through WebSerial bridge and hosted service');
  await host.screenshot({ path: `${output}/lobby-desktop.png`, fullPage: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await guest.screenshot({ path: `${output}/lobby-mobile.png`, fullPage: true });
  await host.locator('#group-action').click(); await guest.locator('#group-action').click();
  await host.waitForFunction(() => document.querySelector('#group-action').textContent === 'Start match' && !document.querySelector('#group-action').disabled);
  await host.locator('#group-action').click();
  for (let round = 1; round <= 2; round++) {
    await host.waitForFunction(r => document.querySelector('#group-instruction').textContent.startsWith(`Round ${r} ·`), round, { timeout: 20000 });
    const deadline = performance.now() + 5000;
    while (!states.every(s => s.state === 4 && s.round === round) && performance.now() < deadline) await new Promise(r => setTimeout(r, 25));
    assert(states.every(s => s.state === 4 && s.round === round), JSON.stringify(states));
    await command('O 0');
  }
  await host.waitForFunction(() => document.querySelector('#group-action').textContent === 'Open next match', null, { timeout: 20000 });
  assert((await host.locator('#group-instruction').textContent()).includes('Willow wins the match'));
  assert(states.every(s => s.state === 7 && s.winner === 1 && s.wins === 8), JSON.stringify(states));
  checks.push('START/seed READY/countdown/GO, real source TOP_OUT, two rounds, packed wins and final match result through live service');
  await guest.screenshot({ path: `${output}/results-mobile.png`, fullPage: true });
  await host.locator('#group-action').click();
  for (const page of pages) await page.waitForFunction(() => document.querySelector('#group-action').textContent === 'Reconnect toy');
  // Stand in for returning both source clients to their Online menu.
  await command(`I 2 ${now()}`);
  for (const page of pages) await page.locator('#group-action').click();
  for (const page of pages) await page.waitForFunction(() => document.querySelector('#group-action').textContent === 'I’m ready' && !document.querySelector('#group-action').disabled);
  checks.push('Explicit next-match reset requires fresh toy handshakes and reuses the connected adapters');
  await guest.locator('#group-leave').click(); await guest.locator('#group-entry:not([hidden])').waitFor();
  assert.equal(await guest.locator('#device-state').textContent(), 'Connected');
  checks.push('390px layout; leaving returns to room list and keeps adapter connected');
  await host.locator('#group-leave').click();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: true, game, checks,
    scope: 'Actual browser/HTTP/WS plus compiled SDK C clients, simulated USB and scripted top-outs; not physical devices' }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, game, checks }, null, 2));
} catch (error) {
  for (const [i, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: `${output}/failure-${i}.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), states, browserErrors: errors }, null, 2));
  throw error;
} finally {
  stopped = true; await tickTask?.catch(() => {}); native.stdin.end(); await browser.close();
}
