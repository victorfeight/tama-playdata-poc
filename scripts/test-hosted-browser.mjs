// Two actual browsers -> actual HTTP/WS service -> real SDK C client code.
// Serial hardware is simulated. Scripted top-outs test match lifecycle.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { encodeTet3 } from '../tama-protocol/dist/tet3.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [url, output, binary, game = 'blocks', mode = 'hosted'] = process.argv.slice(2);
assert(url && output && binary, 'Usage: URL OUTPUT NATIVE_CLIENT_BINARY [GAME] [hosted|direct]');
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
async function waitStates(predicate) {
  const deadline = performance.now() + 5000;
  while (!states.every(predicate) && performance.now() < deadline) await new Promise(r => setTimeout(r, 25));
  assert(states.every(predicate), JSON.stringify(states));
}
try {
  await command(`I 2 ${now()} ${mode === "direct" ? 1 : 0}`);
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    const page = await context.newPage(); pages.push(page);
    await page.exposeFunction('nativeWrite', bytes => command(`R ${index} ${now()} ${Buffer.from(bytes).toString('hex')}`));
    await context.addInitScript(() => {
      const serial = new EventTarget();
      serial.requestPort = async () => ({
        async open() {
          this.readable = new ReadableStream({ start(controller) { window.nativeRx = bytes => controller.enqueue(new Uint8Array(bytes)); window.unplugToy = () => controller.error(new Error("USB unplugged")); }, cancel() { window.nativeRx = undefined; } });
          this.writable = new WritableStream({ write(bytes) { return window.nativeWrite([...bytes]); } });
        }, async close() { window.nativeRx = undefined; }, getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x7523 }; }
      }); Object.defineProperty(navigator, 'serial', { value: serial });
    });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${url}?game=${game}&mode=${mode}`);
    await page.locator('#group-room:not([hidden])').waitFor();
    await page.locator('#group-nickname').fill(index ? 'Willow' : 'Fern');
    await page.locator('#connect').click();
  }
  const [host, guest] = pages;
  await host.locator('#group-public').check(); await host.locator('#group-create').click();
  await host.locator('#group-current:not([hidden])').waitFor();
  await host.waitForFunction(() => document.querySelector('#group-players').textContent.includes('Fern'));
  const code = await host.locator('#group-code').textContent();
  await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedText = text; } } }));
  await host.locator('#group-copy-code').click();
  assert.equal(await host.evaluate(() => window.copiedText), code);
  await host.locator('#group-copy').click();
  const invite = new URL(await host.evaluate(() => window.copiedText));
  assert.equal(invite.searchParams.get('room'), code); assert.equal(invite.searchParams.get('mode'), mode);
  checks.push('Separate Copy code and Copy invite link actions preserve the exact room and mode');
  await guest.locator('#group-refresh').click();
  await guest.waitForFunction(() => document.querySelector('#group-list').textContent.includes('Fern’s room'));
  assert((await guest.locator('#group-list').textContent()).includes(mode === 'direct' ? '1/2' : '1/16'));
  if (mode === 'direct') await guest.locator('#group-list button').filter({ hasText: 'Fern’s room' }).click();
  else { await guest.locator('#group-code-input').fill(code); await guest.locator('#group-join').click(); }
  await guest.locator('#group-current:not([hidden])').waitFor();
  for (const page of pages) await page.waitForFunction(() => { const cards = [...document.querySelectorAll('#group-players li')]; return cards.length === 2 && cards.every(card => /waiting for Online|adapter connected/.test(card.textContent)); });
  // Explicit USB disconnect/reconnect must reattach the room, not leave a stale
  // 'connect toy' card behind a physically Connected label.
  await host.waitForFunction(() => document.querySelector('#group-players').textContent.includes('waiting for Online') || document.querySelector('#group-players').textContent.includes('adapter connected'));
  await host.locator('#connect').click();
  await host.waitForFunction(() => document.querySelector('#device-state').textContent === 'Not connected');
  // Returning to the game menu resets the toy's old protocol session.
  await command(`I 2 ${now()} ${mode === 'direct' ? 1 : 0}`);
  await host.locator('#connect').click();
  await host.waitForFunction(() => document.querySelector('#group-players li').textContent.includes('waiting for Online') || document.querySelector('#group-players li').textContent.includes('adapter connected'));
  // Direct peer loss intentionally detaches both ends; the peer reconnects once.
  if (mode === 'direct') {
    await guest.waitForFunction(() => !document.querySelector('#group-action').hidden);
    await guest.locator('#group-action').click();
  }
  checks.push('Explicit USB reconnect restores the room adapter status without a second local reconnect action');
  for (const page of pages) {
    assert((await page.locator('#toy-mode-hint').textContent()).includes(mode === 'hosted' ? 'Choose Online' : 'Choose Versus'));
    assert.equal(await page.locator('#payload-link').count(), 0);
    // Real valid HELLO in the wrong device mode: do not silently wait forever.
    const wrong = encodeTet3({ session: 0, sequence: 0, type: 1, round: 0, a: 0x12345678,
      b: game === 'blocks' ? (mode === 'hosted' ? 3 : 4) : (mode === 'hosted' ? 0x50500102 : 0x50500202), c: 0 });
    await page.evaluate(bytes => window.nativeRx(bytes), [...wrong.slice(0, 9)]);
    await page.evaluate(bytes => window.nativeRx(bytes), [...wrong.slice(9)]);
    await page.waitForFunction(text => document.querySelector('#group-instruction').textContent.includes(text), mode === 'hosted' ? 'Your toy is in Versus' : 'Your toy is in Online');
    if (mode === 'hosted') assert(await page.locator('#group-action').isDisabled());
  }
  checks.push(`Fragmented wrong-mode HELLO gives C → ${mode === 'hosted' ? 'Online' : 'Versus'} guidance without disconnecting or changing bytes; no download link`);
  tickTask = (async () => { while (!stopped) { await command(`T ${now()}`); await new Promise(r => setTimeout(r, 15)); } })();
  if (mode === 'hosted') for (const page of pages) await page.waitForFunction(() => document.querySelector('#group-action').textContent === 'I’m ready' && !document.querySelector('#group-action').disabled);
  for (const page of pages) {
    assert(await page.locator('#install-actions').isHidden(), 'Game setup should be tucked away in an active room');
    assert(['', 'Invite link copied.'].includes(await page.locator('#group-status').textContent()));
    assert(!(await page.locator('#group-instruction').textContent()).includes('Your toy is in Versus'));
  }
  checks.push(`Two real browsers, named public room, distinct credentials, native HELLO/READY through WebSerial and ${mode} service`);
  await host.screenshot({ path: `${output}/lobby-desktop.png`, fullPage: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await guest.screenshot({ path: `${output}/lobby-mobile.png`, fullPage: true });
  if (mode === 'hosted') {
  await host.locator('#group-action').click(); await guest.locator('#group-action').click();
  await host.waitForFunction(() => document.querySelector('#group-action').textContent === 'Start match' && !document.querySelector('#group-action').disabled);
  await host.locator('#group-action').click();
  }
  for (let round = 1; round <= 2; round++) {
    await host.waitForFunction(r => document.querySelector('#group-instruction').textContent.startsWith(`Round ${r} ·`), round, { timeout: 20000 });
    await waitStates(s => s.state === 4 && s.round === round);
    await command('O 0');
  }
  if (mode === 'hosted') {
  await host.waitForFunction(() => document.querySelector('#group-action').textContent === 'Open next match', null, { timeout: 20000 });
  assert((await host.locator('#group-instruction').textContent()).includes('Willow wins the match'));
  await waitStates(s => s.state === 7 && s.winner === 1 && s.wins === 8);
  checks.push('START/seed READY/countdown/GO, real source TOP_OUT, two rounds, packed wins and final match result through live service');
  await guest.screenshot({ path: `${output}/results-mobile.png`, fullPage: true });
  await host.locator('#group-action').click();
  for (const page of pages) await page.waitForFunction(() => document.querySelector('#group-action').textContent === 'Reconnect toy');
  // Stand in for returning both source clients to their Online menu.
  await command(`I 2 ${now()} ${mode === "direct" ? 1 : 0}`);
  for (const page of pages) await page.locator('#group-action').click();
  for (const page of pages) await page.waitForFunction(() => document.querySelector('#group-action').textContent === 'I’m ready' && !document.querySelector('#group-action').disabled);
  checks.push('Explicit next-match reset requires fresh toy handshakes and reuses the connected adapters');
  } else {
    await host.waitForFunction(() => document.querySelector('#match').textContent.endsWith('Finished'));
    assert((await host.locator('#match').textContent()).includes('Willow 2'));
    // The first browser can observe RESULT before the peer consumes it.
    await waitStates(s => s.state === 7 && s.winner === 1 && s.wins === 8);
    checks.push('Direct native pair completed two rounds with personalized score; no browser readiness or host start required');
  }
  await guest.locator('#group-leave').click(); await guest.locator('#group-entry:not([hidden])').waitFor();
  assert.equal(await guest.locator('#device-state').textContent(), 'Connected');
  checks.push('390px layout; leaving returns to room list and keeps adapter connected');
  if (mode === 'direct') {
    await host.waitForFunction(() => !document.querySelector('#group-action').hidden && document.querySelector('#group-action').textContent === 'Reconnect toy');
    assert((await host.locator('#group-instruction').textContent()).includes('friend disconnected'));
    await command(`I 2 ${now()} 1`);
    await guest.locator('#group-code-input').fill(code); await guest.locator('#group-join').click();
    await guest.locator('#group-current:not([hidden])').waitFor();
    await host.locator('#group-action').click();
    await host.waitForFunction(() => document.querySelector('#group-instruction').textContent.startsWith('Round 1 ·'), null, { timeout: 20000 });
    await waitStates(s => s.state === 4 && s.round === 1);
    await guest.evaluate(() => window.unplugToy());
    await guest.waitForFunction(() => document.querySelector('#device-state').textContent === 'Not connected');
    await host.waitForFunction(() => document.querySelector('#group-instruction').textContent.includes('friend disconnected'));
    assert.equal(await guest.locator('#connect').textContent(), 'Connect Paradise');
    await guest.locator('#group-leave').click();
    checks.push('UART read failure clears the connection indicator and stops the peer session');
    checks.push('Peer leave stops the old direct session; same adapters and named room reconnect with fresh native game sessions');
  }
  await host.locator('#group-leave').click();
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: true, game, mode, checks,
    scope: 'Actual browser/HTTP/WS plus compiled SDK C clients, simulated USB and scripted top-outs; not physical devices' }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, game, mode, checks }, null, 2));
} catch (error) {
  for (const [i, page] of pages.entries()) if (!page.isClosed()) await page.screenshot({ path: `${output}/failure-${i}.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), states, browserErrors: errors }, null, 2));
  throw error;
} finally {
  stopped = true; await tickTask?.catch(() => {}); native.stdin.end(); await browser.close();
}
