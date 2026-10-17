/** Reproduce with: node relay-server/node_modules/tsx/dist/cli.mjs
 * scripts/test-hosted-native.ts SDK_REPOSITORY OUTPUT_DIRECTORY
 * Compiles and drives real SDK C transport/Blocks clients. No firmware needed. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Tet3Session, type Tet3Message } from "../tama-protocol/src/tet3-session";
import { encodeTet3, type Tet3Packet } from "../tama-protocol/src/tet3";
import { HostedMatch, BLOCKS_HOSTED, PUZZLE_HOSTED } from "../tama-protocol/src/hosted-match";
const [repository, output] = process.argv.slice(2);
assert(repository && output, "Pass SDK repository and output directory");
mkdirSync(output, { recursive: true });
const sdk = resolve(repository, "sdk/paradise");
function compile(name: string, extra: string[] = []) {
  const executable = resolve(output!, name);
  const r = spawnSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-I" + sdk,
    join(sdk, `net/tests/hosted/${name}.c`), join(sdk, "net/tet3_session.c"),
    join(sdk, "net/tet3_wire.c"), ...extra.map(p => join(sdk, p)), "-o", executable], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); return executable;
}
const endpointBinary = compile("endpoint");
const blocksBinary = compile("blocks", ["examples/tetris-versus/link.c", "examples/tetris-versus/rules.c"]);
const puzzleBinary = compile("puzzle", ["examples/pocket-puzzle/link.c", "examples/pocket-puzzle/rules.c"]);
const frame = (fields: Partial<Tet3Packet>) => Buffer.from(encodeTet3({ session: 123 ^ 456, sequence: 1,
  type: 3, round: 0, a: 0, b: 0, c: 0, ...fields })).toString("hex");
const actions: string[] = [];
const init = () => actions.push("I 0 123 4");
const rx = (now: number, fields: Partial<Tet3Packet>) => actions.push(`R ${now} ${frame(fields)}`);
const hello = () => rx(1, { session: 0, sequence: 0, type: 1, a: 456, b: 4 });
init(); actions.push("P 0");
rx(1, { session: 0, sequence: 0, type: 1, a: 456, b: 3 }); // wrong mode
hello(); rx(2, { session: 777 }); rx(2, { sequence: 2 });
for (const type of [0, 16, 0xffffffff]) rx(2, { type });
rx(3, {}); actions.push("P 3", "P 4", "P 153", "P 154");
rx(155, { type: 2, sequence: 0, a: 2 }); rx(156, { type: 2, sequence: 0, a: 1 });
rx(157, {}); actions.push("P 157", "Q 7 1 4 9 1", "P 158", "P 308");
rx(309, { type: 2, sequence: 0, a: 2 }); actions.push("P 1309", "P 5309", "P 5310");
// Each possible fragmentation boundary, stale partial frames and delimiter recovery.
for (let cut = 1; cut < 39; cut++) {
  init(); const wire = frame({ session: 0, sequence: 0, type: 1, a: 456, b: 4 });
  actions.push(`R 1 ${wire.slice(0, cut * 2)}`, `R 2 ${wire.slice(cut * 2)}`, "P 2");
  init(); actions.push(`R 1 ${wire.slice(0, cut * 2)}`, `R 252 ${wire.slice(cut * 2)}`); hello();
}
init(); actions.push(`R 1 ${"01".repeat(200)}00`); hello();
init(); for (let i = 0; i < 9; i++) actions.push("Q 7 1 1 0 1");
init(); rx(1, { session: 0, sequence: 0, type: 1, a: 123, b: 4 });
// CRC-valid adversarial words and noise must not consume valid sequence numbers.
let rng = 12345;
const random = () => (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0);
for (let i = 0; i < 150; i++) {
  init(); hello();
  rx(2, { session: random(), sequence: random(), type: random() % 20, round: random(), a: random(), b: random(), c: random() });
  rx(3, {}); actions.push("P 4");
}
const native = spawnSync(endpointBinary, [], { input: actions.join("\n") + "\n", encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
assert.equal(native.status, 0, native.stderr);
const expected = native.stdout.trim().split("\n").map(line => JSON.parse(line));
let session: Tet3Session;
let sent: Uint8Array[] = [], messages: number[][] = [];
for (const [i, action] of actions.entries()) {
  sent = []; messages = [];
  const [op, ...args] = action.split(" ");
  const nums = args.map(Number);
  if (op === "I") session = new Tet3Session(nums[2]!, nums[1]!, nums[0]!, bytes => sent.push(bytes),
    m => messages.push([m.type, m.round, m.a, m.b, m.c]), () => {});
  else if (op === "R") session!.receive(Buffer.from(args[1]!, "hex"), nums[0]!);
  else if (op === "P") session!.poll(nums[0]!);
  else session!.enqueue(nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!);
  const actual = { session: session!.session, ready: session!.ready, error: !!session!.error,
    pending: session!.pending, retries: session!.retries, wire: Buffer.concat(sent).toString("hex"), messages };
  // TS releases queued memory on terminal error; C retains its fixed ring.
  if (actual.error) expected[i].pending = actual.pending;
  assert.deepEqual(actual, expected[i], `C/TS action ${i}: ${action}`);
}
writeFileSync(join(output, "endpoint-trace.json"), JSON.stringify({ passed: true, comparisons: actions.length,
  scope: "Real SDK C transport versus TS host policy; byte-identical frames and state, no physical UART", actions }, null, 2));
console.log(`PASS ${actions.length} C/TS endpoint trace comparisons`);

class Driver {
  readonly child;
  private pending: ((line: string) => void)[] = [];
  constructor(binary: string) { this.child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] }); createInterface({ input: this.child.stdout }).on("line", line => {
    const resolve = this.pending.shift(); assert(resolve, "Unexpected native output"); resolve(line);
  }); }
  async run(command: string): Promise<any[]> {
    const line = new Promise<string>((resolve, reject) => {
      const failed = (error: Error) => reject(error);
      this.child.once("error", failed);
      this.pending.push(value => { this.child.off("error", failed); resolve(value); });
    });
    this.child.stdin.write(command + "\n");
    return JSON.parse(await line);
  }
  close() { this.child.stdin.end(); }
}
const receipts: unknown[] = [];
async function matchScenario(count: number, latency: number, loss: boolean, puzzle = false, variant = "wins") {
  const driver = new Driver(puzzle ? puzzleBinary : blocksBinary);
  const policy = puzzle ? PUZZLE_HOSTED : BLOCKS_HOSTED;
  let now = 0, serial = 0, states: any[] = [], match: HostedMatch | undefined;
  let maxQueue = 0, deliveredAttacks = 0;
  const retired = new Set<number>();
  const activeStates = () => states.filter((_, i) => !retired.has(i));
  type Delivery = { at: number; index: number; host: boolean; bytes: Uint8Array };
  let network: Delivery[] = [];
  const lastAt = new Map<string, number>();
  const schedule = (index: number, host: boolean, bytes: Uint8Array) => {
    if (retired.has(index)) return;
    serial++;
    if (loss && serial % 19 === 0) return; // Full-frame loss; ACK/retries must recover.
    const key = `${index}/${host}`;
    const at = Math.max(now + latency, (lastAt.get(key) ?? 0) + 1);
    const copies = loss && serial % 23 === 0 ? 2 : 1;
    for (let copy = 0; copy < copies; copy++) {
      // Preserve order within each UART stream while splitting every frame.
      network.push({ at: at + copy * 3, index, host, bytes: bytes.slice(0, 13) });
      network.push({ at: at + copy * 3 + 1, index, host, bytes: bytes.slice(13) });
    }
    lastAt.set(key, at + copies * 3);
  };
  const endpoints = Array.from({ length: count }, (_, i) => new Tet3Session(policy.mode, 10000 + i, now,
    bytes => schedule(i, false, bytes), message => {
      if (message.type === 6) deliveredAttacks++;
      match?.receive(i, message, now);
    }, reason => match?.disconnect(i, reason, now)));
  const ingest = (snapshot: any[]) => {
    states = snapshot;
    snapshot.forEach((s, i) => { if (s.wire) schedule(i, true, Buffer.from(s.wire, "hex")); });
  };
  async function step() {
    now += 25;
    const due = network.filter(e => e.at <= now).sort((a, b) => a.at - b.at);
    network = network.filter(e => e.at > now);
    for (const event of due) {
      if (retired.has(event.index)) continue;
      if (event.host) endpoints[event.index]!.receive(event.bytes, now);
      else ingest(await driver.run(`R ${event.index} ${now} ${Buffer.from(event.bytes).toString("hex")}`));
    }
    ingest(await driver.run(`T ${now}`));
    match?.tick(now);
    endpoints.forEach(e => e.poll(now));
    maxQueue = Math.max(maxQueue, ...endpoints.map(e => e.pending), ...(match?.snapshot().players.map(s => s.queued) ?? []));
    assert(endpoints.every((e, i) => retired.has(i) || !e.error), `Host endpoint failed ${endpoints.map(e => e.error)}`);
    assert(states.every((s, i) => retired.has(i) || !s.error), `Native client failed ${JSON.stringify(states)}`);
  }
  async function until(check: () => boolean, duration = 20000) {
    const end = now + duration;
    while (!check() && now < end) await step();
    assert(check(), `Timed out at ${now}: ${JSON.stringify(match?.snapshot())}; native ${JSON.stringify(states)}`);
  }
  try {
    ingest(await driver.run(`I ${count} 0`));
    await until(() => endpoints.every(e => e.ready && !e.pending));
    match = new HostedMatch(policy, endpoints.map((endpoint, i) => ({ id: `seat-${i}`, endpoint })), random);
    match.start(now);
    await until(() => states.every(s => s.state === 4));
    states.forEach((s, i) => { assert.equal(s.player, i); assert.equal(s.count, count); assert.equal(s.seed, match!.seed); });
    // Source sends an attack, not an invented host semantic event. Retransmission
    // and duplication must deliver exactly one garbage operation to one opponent.
    const target = match.snapshot().players[0]!.target!;
    ingest(await driver.run("A 0 4"));
    await until(() => states[target].pending === 4);
    for (let n = 0; n < 30; n++) await step();
    assert.equal(deliveredAttacks, 1);
    assert.equal(states.reduce((total, s) => total + s.pending, 0), 4);
    assert.equal(states[target].garbageId, 1);
    // Everyone but the last seat tops out. TOP_OUT's zero fields must not
    // accidentally eliminate seat zero repeatedly. All sixteen win bits count.
    let roundOffset = 0;
    if (variant === "tie") {
      for (let i = 0; i < count; i++) ingest(await driver.run(`O ${i}`));
      await until(() => states.every(s => s.state === 6));
      states.forEach(s => { assert.equal(s.winner, 255); assert.equal(s.wins, 0); });
      await until(() => states.every(s => s.state === 4 && s.round === 2));
      roundOffset = 1;
    } else if (variant === "disconnect") {
      retired.add(1); endpoints[1]!.stop("Injected adapter loss");
      assert.equal(match.snapshot().players[1]!.connected, false);
    }
    for (let round = 1; round <= 2; round++) {
      for (let i = 0; i < count - 1; i++) if (!retired.has(i)) ingest(await driver.run(`O ${i}`));
      await until(() => activeStates().every(s => s.state === (round === 2 ? 7 : 6)));
      const wins = (round * 2 ** ((count - 1) * 2)) >>> 0;
      activeStates().forEach(s => { assert.equal(s.winner, count - 1); assert.equal(s.wins, wins); });
      if (round === 1) {
        await until(() => activeStates().every(s => s.state === 4 && s.round === 2 + roundOffset));
        if (variant === "disconnect") {
          await until(() => activeStates().every(s => s.alive === ((1 << count) - 1 & ~2)));
          activeStates().forEach(s => assert.equal(s.count, count));
        }
      }
    }
    await until(() => match!.phase === "results");
    receipts.push({ game: policy.id, variant, players: count, oneWayLatencyMs: latency, deterministicLossAndDuplicates: loss,
      virtualDurationMs: now, retries: endpoints.reduce((n, e) => n + e.retries, 0), maxQueue,
      finalWins: match.wins, passed: true });
    console.log(`PASS native ${policy.id} ${count} players, ${latency}ms/leg, loss=${loss}, ${variant}, ${now}ms virtual`);
  } finally { driver.close(); }
}
for (const count of [2, 3, 8, 16]) await matchScenario(count, 25, false);
await matchScenario(16, 125, true);
for (const count of [2, 3, 8, 16]) await matchScenario(count, 25, false, true);
await matchScenario(16, 125, true, true);
for (const puzzle of [false, true]) {
  await matchScenario(3, 25, false, puzzle, "tie");
  await matchScenario(3, 25, false, puzzle, "disconnect");
}
writeFileSync(join(output, "native-matches.json"), JSON.stringify({ passed: true, scenarios: receipts,
  scope: "Native C SDK transport + Blocks/Pocket Puzzle link/rules, framed bytes through TS host; scripted attacks/top-outs, not full device/board/WAN qualification" }, null, 2) + "\n");
