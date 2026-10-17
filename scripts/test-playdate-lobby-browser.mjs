import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from '../relay-server/node_modules/ws/wrapper.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const [url, output, relayUrl] = process.argv.slice(2);
if (!url || !output || !relayUrl) throw new Error('Usage: test-playdate-lobby-browser.mjs URL OUTPUT RELAY_URL');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
const desktops = [];
const api = async (route, headers = {}) => {
  const response = await fetch(relayUrl + route, { method: 'POST', headers });
  assert(response.ok, `${route}: ${response.status}`);
  return response.json();
};
const desktop = async (code, token, role) => {
  const socket = new WebSocket(`${relayUrl.replace(/^http/, 'ws')}/ws/${code}?role=${role}`, token);
  const messages = []; desktops.push(socket);
  socket.on('message', (data, binary) => messages.push(binary ? [...data] : data.toString()));
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, messages };
};
const until = async predicate => {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert(Date.now() < deadline, 'Desktop message timeout'); await new Promise(r => setTimeout(r, 20)); }
};
try {
  const makePage = async () => {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    await context.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', event => {
            if (typeof event.data !== 'string') return;
            try { if (JSON.parse(event.data).startPrompt === 'ready') { window.readySocket = this; window.readySnapshot = event.data; } } catch {}
          });
        }
      };
      const serial = new EventTarget();
      serial.requestPort = async () => ({
        async open() {
          this.readable = new ReadableStream({ start(c) { window.enqueueUart = bytes => c.enqueue(new Uint8Array(bytes)); } });
          this.writable = new WritableStream({ write(bytes) { (window.uartWrites ??= []).push([...bytes]); } });
        }, async close() {}, getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x7523 }; }
      });
      Object.defineProperty(navigator, 'serial', { value: serial });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.locator('#refresh-rooms:not([disabled])').waitFor();
    return page;
  };
  const host = await makePage(), guest = await makePage();
  assert.equal(await host.title(), 'Playdate · Paradise Link');
  assert(!(await host.locator('#public-room').isChecked()));
  await host.screenshot({ path: `${output}/desktop-entry.png`, fullPage: true });
  await host.locator('#create-room').click();
  assert(await host.locator('#lobby-entry').isVisible());
  await host.locator('#nickname').fill('Fern'); await host.locator('#public-room').check();
  await host.locator('#create-room').click(); await host.locator('#room-panel:not([hidden])').waitFor();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Waiting for your friend');
  const code = await host.locator('#active-code').textContent(); assert.match(code, /^[A-Z0-9]{6}$/);
  await guest.locator('#nickname').fill('<b>Willow</b>'); await guest.locator('#refresh-rooms').click();
  await guest.getByRole('button', { name: 'Join Fern’s room' }).click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’re both here');
  assert.equal(await host.locator('#room-members strong').nth(1).textContent(), '<b>Willow</b>');
  assert.equal(await host.locator('#room-members b').count(), 0);
  checks.push('Existing Playdate entry, private default, nickname validation, public discovery, text-safe player names');
  await host.locator('#connect-serial').click(); await guest.locator('#connect-serial').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll wait on Playdate');
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll press B');
  assert((await host.locator('#starter-summary').textContent()).includes('presses B. You wait.'));
  assert((await guest.locator('#starter-summary').textContent()).includes('You press B.'));
  await host.evaluate(() => window.enqueueUart([1, 2, 3, 4]));
  await guest.waitForFunction(() => window.uartWrites?.some(b => b.join() === '1,2,3,4'));
  await guest.evaluate(() => window.enqueueUart([5, 6, 7]));
  await host.waitForFunction(() => window.uartWrites?.some(b => b.join() === '5,6,7'));
  assert.deepEqual(await guest.evaluate(() => window.uartWrites), [[1, 2, 3, 4]]);
  checks.push('Two real HTTP/WebSocket room clients; binary UART in both directions; room JSON never written to serial; role-specific instructions');
  await host.locator('#starter-choice:not([hidden])').waitFor();
  await host.locator('#start-me').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll press B');
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll wait on Playdate');
  assert.equal(await guest.locator('#start-friend').getAttribute('aria-pressed'), 'true');
  await host.reload();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’re both here');
  await host.locator('#connect-serial').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll press B');
  await guest.locator('#starter-choice:not([hidden])').waitFor();
  await guest.locator('#start-me').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll press B');
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll wait on Playdate');
  assert.deepEqual(await guest.evaluate(() => window.uartWrites), [[1, 2, 3, 4]]);
  checks.push('Either player chooses the starter; both pages agree; selection survives reload; selection never writes to UART');

  await guest.locator('.exchange-details').evaluate(node => node.open = true);
  const downloaded = guest.waitForEvent('download');
  await guest.locator('#save-log').click();
  const logDownload = await downloaded;
  await logDownload.saveAs(`${output}/guest-connection.txt`);
  const logText = await (await import('node:fs/promises')).readFile(`${output}/guest-connection.txt`, 'utf8');
  assert(logText.includes('Adapter: 1a86:7523'));
  assert(logText.includes(`Room: ${code}`));
  assert(logText.includes('Bytes in: 4; out: 3'));
  assert(/\[\d{4}-\d{2}-\d{2}T[^\]]+\] <- peer:/.test(logText));
  assert(logText.includes('-> device:'));
  assert(!logText.includes((await guest.evaluate(() => JSON.parse(sessionStorage.getItem('playdate-lobby')))).token));
  await guest.locator('.exchange-details').evaluate(node => node.open = false);
  checks.push('Saved timestamped local diagnostics include adapter identity and both byte directions, without room credentials');
  await guest.locator('#start-prompt').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Go to Connection → Playdate and wait now');
  await host.locator('#start-prompt').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B now');
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Wait—your friend is starting');
  assert(await guest.locator('#start-window').isVisible());
  assert(await host.locator('#start-window').isHidden());
  const readyValue = await guest.locator('#start-window-progress').evaluate(p => p.value);
  await guest.waitForFunction(v => document.querySelector('#start-window-progress').value < v - 200, readyValue);
  await guest.evaluate(() => {
    const progress = document.querySelector('#start-window-progress'), before = progress.value;
    window.readySocket.dispatchEvent(new MessageEvent('message', { data: window.readySnapshot }));
    document.dispatchEvent(new Event('visibilitychange'));
    if (progress.value > before) throw new Error('Repeated readiness snapshot extended the window');
  });
  await guest.screenshot({ path: `${output}/press-b-now.png`, fullPage: true });
  assert.deepEqual(await guest.evaluate(() => window.uartWrites), [[1, 2, 3, 4]]);
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Go to Connection → Playdate and wait now', null, { timeout: 12000 });
  assert(await guest.locator('#start-window').isHidden());
  await host.locator('#start-prompt').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B now');
  await guest.evaluate(() => window.enqueueUart([80, 75, 84, 32, 50, 13, 10]));
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Follow your toy');
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Follow your toy');
  assert(await guest.locator('#start-window').isHidden());
  assert(!(await host.locator('#start-prompt').isVisible()));
  assert(!(await guest.locator('#start-prompt').isVisible()));
  assert(!/fail|retry|another attempt/i.test(await guest.locator('#next-instruction').textContent()));
  assert(!/To retry/.test(await guest.locator('body').innerText()));
  await guest.screenshot({ path: `${output}/normal-exchange.png`, fullPage: true });
  // Recorded native unanswered-request ending, sent through the mock adapter,
  // real browser bridge, room socket, duplex observer and shared presentation.
  await guest.evaluate(() => window.enqueueUart([...new TextEncoder().encode('PKT 2\r\nPKT 2\r\nPKT 2\r\nCAN\r\n')]));
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'The exchange stopped');
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'The exchange stopped');
  assert(!(await guest.locator('#start-prompt').isEnabled()));
  await host.screenshot({ path: `${output}/abort-receiver.png`, fullPage: true });
  await host.locator('#start-prompt').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B now');
  checks.push('Framed CAN returns both pages to preparation; normal exchange hides retry advice/buttons; receiver must freshly confirm');
  checks.push('Starter-only readiness countdown shrinks, expires without claiming failure, and disappears on toy traffic');
  checks.push('Ready request and receiver confirmation update both pages; readiness expires; real toy bytes end the prompt without claiming success; controls never generate UART');

  await host.screenshot({ path: `${output}/desktop-paired.png`, fullPage: true });
  await guest.setViewportSize({ width: 390, height: 844 });
  assert(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await guest.screenshot({ path: `${output}/mobile-paired.png`, fullPage: true });
  await guest.locator('#connect-serial').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’re both here');
  assert(await guest.locator('#room-panel').isVisible());
  await guest.locator('#connect-serial').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll wait on Playdate');
  await guest.reload();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’re both here');
  await guest.locator('#connect-serial').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’ll wait on Playdate');
  await guest.locator('#leave-room').click(); await guest.locator('#lobby-entry:not([hidden])').waitFor();
  assert.equal(await guest.locator('#adapter-status').textContent(), 'Adapter connected');
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Waiting for your friend');
  await host.locator('#leave-room').click(); await host.locator('#lobby-entry:not([hidden])').waitFor();
  await host.locator('#public-room').uncheck(); await host.locator('#create-room').click();
  await host.locator('#room-panel:not([hidden])').waitFor();
  await host.waitForFunction(() => document.querySelector('#room-visibility').textContent === 'Private room');
  const privateCode = await host.locator('#active-code').textContent();
  assert.match(privateCode, /^[A-Z0-9]{6}$/);
  await guest.locator('#refresh-rooms').click();
  await guest.locator('#refresh-rooms:not([disabled])').waitFor();
  assert.equal(await guest.getByRole('button', { name: 'Join Fern’s room' }).count(), 0);
  await guest.locator('#room-code').fill(privateCode); await guest.locator('#join-room').click();
  await guest.locator('#room-panel:not([hidden])').waitFor();
  checks.push('390px layout; disconnect without leaving; reload/rejoin; explicit leave frees seat; private code join');
  await guest.locator('#leave-room').click(); await host.locator('#leave-room').click();
  // New browser host, old desktop guest: exercise the actual legacy HTTP/WS contract.
  await host.locator('#create-room').click();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Waiting for your friend');
  const browserCode = await host.locator('#active-code').textContent();
  const ticket = await api(`/sessions/${browserCode}/join`);
  assert.deepEqual(await api(`/sessions/${browserCode}/join`), ticket);
  const oldGuest = await desktop(browserCode, ticket.token, 'b');
  await until(() => oldGuest.messages.includes('peer connected'));
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Open Playdate and wait');
  assert((await host.locator('#room-members').textContent()).includes('check adapter in their app'));
  assert(await host.locator('#starter-choice').isHidden());
  assert((await host.locator('#next-instruction').textContent()).includes('start the adapter bridge'));
  await host.evaluate(() => window.enqueueUart([91, 0, 255]));
  await until(() => oldGuest.messages.some(m => Array.isArray(m) && m.join() === '91,0,255'));
  oldGuest.socket.send(Buffer.from([92, 1, 254]));
  await host.waitForFunction(() => window.uartWrites?.some(b => b.join() === '92,1,254'));
  assert(oldGuest.messages.filter(m => typeof m === 'string').every(m => m === 'peer connected' || m === 'peer disconnected'));
  oldGuest.socket.close();
  await host.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Waiting for your friend');
  await host.locator('#leave-room').click();
  checks.push('Browser host with legacy desktop guest: idempotent guest ticket, presence-only text, unchanged binary UART, explicit unknown adapter state');

  // Old desktop host, new browser guest: fallback and legacy presence adaptation.
  const oldRoom = await api('/sessions', { 'x-app-name': 'tamahome-desktop-playdate' });
  const oldHost = await desktop(oldRoom.code, oldRoom.token, 'a');
  await guest.locator('#room-code').fill(oldRoom.code); await guest.locator('#join-room').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B once');
  await until(() => oldHost.messages.includes('peer connected'));
  assert((await guest.locator('#next-instruction').textContent()).includes('press B on your toy'));
  oldHost.socket.send(Buffer.from([93, 2, 253]));
  await guest.waitForFunction(() => window.uartWrites?.some(b => b.join() === '93,2,253'));
  await guest.evaluate(() => window.enqueueUart([94, 3, 252]));
  await until(() => oldHost.messages.some(m => Array.isArray(m) && m.join() === '94,3,252'));
  oldHost.socket.close();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Waiting for your friend');
  assert.equal((await api(`/sessions/${oldRoom.code}/join`)).token, oldRoom.token);
  const resumedHost = await desktop(oldRoom.code, oldRoom.token, 'a');
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B once');
  resumedHost.socket.send(Buffer.from([95, 4, 251]));
  await guest.waitForFunction(() => window.uartWrites?.some(b => b.join() === '95,4,251'));
  await guest.reload();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'You’re both here');
  await guest.locator('#connect-serial').click();
  await guest.waitForFunction(() => document.querySelector('#next-heading').textContent === 'Press B once');
  await guest.locator('#leave-room').click();
  await until(() => resumedHost.messages.includes('peer disconnected'));
  assert(await guest.locator('#starter-choice').isHidden());
  checks.push('Legacy desktop host with browser guest: fallback, bidirectional UART, host reconnect, browser reload and leave; no false adapter-ready claims');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: true, checks, scope: 'Actual local lobby service and browser pages; simulated UART streams, not hardware or native firmware' }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} catch (error) {
  const pages = browser.contexts().flatMap(context => context.pages());
  const states = [];
  for (const [index, page] of pages.entries()) {
    states.push(await page.evaluate(() => ({ text: document.body.innerText, errors: window.uartWrites })));
    await page.screenshot({ path: `${output}/failure-${index}.png`, fullPage: true });
  }
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), errors, checks, states }, null, 2));
  throw error;
} finally { for (const socket of desktops) socket.close(); await browser.close(); }
