// Real browser UI with explicit simulated UART/room endpoints. Native pair
// testing separately exercises the real HTTP/WebSocket relay and device code.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [url, output] = process.argv.slice(2);
if (!url || !output) throw new Error("Usage: node scripts/test-game-browser.mjs http://127.0.0.1:5176/games/ /new/evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "serial", { value: {
      requestPort: async () => ({
        async open() {
          this.readable = new ReadableStream({ start(controller) { window.testSerialController = controller; } });
          this.writable = new WritableStream({ write(bytes) { window.testSerialWrites = [...(window.testSerialWrites ?? []), [...bytes]]; } });
        }, async close() {}, getInfo() { return { usbVendorId: 0x1a86, usbProductId: 0x7523 }; }
      })
    }});
  });
  await context.route("**/sessions", route => route.fulfill({ json: { code: "ABC123", token: "test-room-token" } }));
  await context.route("**/sessions/*/join", route => route.fulfill({ json: { token: "test-room-token", app: "playdate-web" } }));
  let peer;
  await context.routeWebSocket("**/ws/**", socket => { peer = socket; setTimeout(() => socket.send("peer connected"), 50); });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url); await page.locator("#download:not([hidden])").waitFor();
  assert(await page.locator("#create").isDisabled());
  const href = await page.locator("#payload-link").getAttribute("href");
  assert(/^\.\/blocks\.[a-f0-9]{12}\.pdlo\.bin$/.test(href));
  assert((await context.request.get(new URL(href, url).href)).ok());
  checks.push("initial connection gating and packaged source payload download");
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.locator("#connect").click();
  await page.waitForFunction(() => document.querySelector("#device-state").textContent === "Connected");
  await page.locator("#code").fill("BAD"); await page.locator("#join").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("six-character"));
  await page.locator("#code").fill("ABC123"); await page.locator("#join").click();
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("another activity"));
  assert.equal(await page.locator("#device-state").textContent(), "Connected");
  checks.push("invalid room and incompatible activity keep healthy serial connection");
  await page.locator("#create").click(); await page.locator("#play-instructions:not([hidden])").waitFor();
  assert.equal(await page.locator("#room-code").textContent(), "ABC123");
  assert(await page.locator("#create").isDisabled());
  peer.send(Buffer.from([1, 2, 3]));
  await page.waitForFunction(() => window.testSerialWrites?.some(bytes => bytes.join() === "1,2,3"));
  assert(!(await page.evaluate(() => window.testSerialWrites)).some(bytes => bytes.length > 3));
  checks.push("room creation, peer prompt, binary forwarding; control text stays off UART");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/mobile-room.png`, fullPage: true });
  checks.push("390px layout has no horizontal overflow");
  peer.send("peer disconnected");
  await page.waitForFunction(() => document.querySelector("#device-state").textContent === "Not connected");
  assert(await page.locator("#room").isHidden());
  assert.equal(await page.locator("#match").textContent(), "Waiting");
  await page.locator("#connect").click(); await page.locator("#create").click();
  await page.locator("#room:not([hidden])").waitFor(); await page.locator("#leave").click();
  await page.waitForFunction(() => document.querySelector("#device-state").textContent === "Not connected");
  checks.push("peer loss and explicit leave clean up; reconnect creates fresh UI state");
  assert.deepEqual(errors, []);
  await writeFile(`${output}/browser.json`, JSON.stringify({ passed: true, checks, scope: "Chromium UI with simulated UART/room; no physical serial qualification" }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await browser.close(); }
