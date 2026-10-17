import { describe, it, expect } from "vitest";
import { HostedMatch, BLOCKS_HOSTED, type HostedEndpoint } from "../../tama-protocol/src/hosted-match";
import type { Tet3Message } from "../../tama-protocol/src/tet3-session";
class Endpoint implements HostedEndpoint {
  ready = true; error: string | undefined; queue: Tet3Message[] = []; sent: Tet3Message[] = [];
  get pending() { return this.queue.length; }
  enqueue(type: number, round: number, a: number, b: number, c: number) { this.queue.push({ type, round, a, b, c }); return true; }
  drain() { this.sent.push(...this.queue); this.queue = []; }
}
const msg = (type: number, round = 1, a = 0, b = 0, c = 0) => ({ type, round, a, b, c });
function fixture(count = 3) {
  const endpoints = Array.from({ length: count }, () => new Endpoint());
  const match = new HostedMatch(BLOCKS_HOSTED, endpoints.map((endpoint, i) => ({ id: String(i), endpoint })), () => 123);
  const drain = () => endpoints.forEach(e => e.drain());
  const prepare = (now = 0) => {
    match.tick(now); drain();
    endpoints.forEach((_, i) => { if (match.snapshot().players[i]!.connected) match.receive(i, msg(3, match.round, match.seed), now + 1); });
    match.tick(now + 2); match.tick(now + 3002); drain(); expect(match.phase).toBe("playing");
  };
  match.start(0); prepare(); return { match, endpoints, drain, prepare };
}
describe("external-host match policy", () => {
  it("accepts start behind lobby traffic but waits for seed READY and queue drain", () => {
    const endpoints = [new Endpoint(), new Endpoint()];
    endpoints.forEach(e => e.queue.push(msg(11, 0)));
    const match = new HostedMatch(BLOCKS_HOSTED, endpoints.map((endpoint, i) => ({ id: String(i), endpoint })), () => 42);
    match.start(0); match.tick(0);
    expect(endpoints[0]!.queue.map(m => m.type)).toEqual([11, 4]);
    endpoints.forEach((_, i) => match.receive(i, msg(3, 1, 42), 1));
    match.tick(2); expect(match.phase).toBe("preparing");
    endpoints.forEach(e => e.drain()); match.tick(3);
    expect(match.phase).toBe("countdown");
  });
  it("routes to one target, rejects stale/invalid events and identifies zero-field TOP_OUT by seat", () => {
    const { match, endpoints } = fixture();
    for (const bad of [msg(6, 0, 4), msg(6, 1, 8), msg(6, 1, 0), msg(6, 1, 4, 1), msg(8, 1, 2)]) match.receive(2, bad, 3010);
    expect(match.alive).toBe(7);
    const target = match.snapshot().players[2]!.target!;
    match.receive(2, msg(6, 1, 4), 3020); match.tick(3020);
    expect(endpoints.flatMap(e => e.queue).filter(m => m.type === 7)).toEqual([msg(7, 1, 4, 3, 1)]);
    expect(endpoints[target]!.queue[0]!.type).toBe(7);
    match.receive(2, msg(8), 3030); match.receive(2, msg(8), 3030); expect(match.alive).toBe(3);
    match.receive(2, msg(6, 1, 4), 3040); expect(match.snapshot().players[2]!.target).toBeUndefined();
  });
  it("settles near-simultaneous losses as a tie without assigning a win", () => {
    const { match } = fixture(2);
    match.receive(0, msg(8), 4000); match.tick(4299); expect(match.phase).toBe("playing");
    match.receive(1, msg(8), 4299); match.tick(4300);
    expect(match.winner).toBe(255); expect(match.wins).toBe(0); expect(match.phase).toBe("round-result");
  });
  it("coalesces a 15-elimination burst before the eight-frame endpoint queue", () => {
    const { match, endpoints } = fixture(16);
    for (let i = 0; i < 15; i++) match.receive(i, msg(8), 4000);
    expect(match.snapshot().players.every(s => s.queued === 1)).toBe(true); match.tick(4300);
    expect(endpoints.every(e => e.queue.length === 2)).toBe(true);
    expect(endpoints[15]!.queue).toEqual([msg(8, 1, 14, 32768), msg(9, 1, 15, 0x40000000)]);
  });
  it("keeps frozen indices and marks absent seats out in the next round", () => {
    const { match, endpoints, drain, prepare } = fixture(3);
    match.disconnect(1, "Disconnected", 4000); match.receive(0, msg(8), 4010); match.tick(4310); drain(); match.tick(7310);
    expect(match.phase).toBe("preparing"); expect(match.round).toBe(2); expect(match.alive).toBe(5);
    prepare(7320);
    expect(endpoints[2]!.sent.some(m => m.type === 4 && m.round === 2 && m.b === 515)).toBe(true);
    expect(endpoints[2]!.sent.at(-1)).toEqual(msg(8, 2, 1, 5));
  });
  it("finishes explicitly by forfeit with one connected seat", () => {
    const { match, endpoints } = fixture(2);
    match.disconnect(0, "Adapter lost", 4000); match.tick(4000);
    expect(match.phase).toBe("results"); expect(match.reason).toContain("disconnect");
    expect(endpoints[1]!.queue.at(-1)).toEqual(msg(10, 1, 1));
  });
  it("retires slow recipients instead of dropping attacks or blocking other players", () => {
    const { match, endpoints } = fixture(3);
    for (let i = 0; i < 80; i++) {
      match.receive(0, msg(6, 1, 1), 4000 + i); match.tick(4000 + i); endpoints[0]!.drain(); endpoints[2]!.drain();
    }
    expect(match.snapshot().players[1]!.connected).toBe(false);
    expect(match.snapshot().players[1]!.reason).toContain("keep up"); expect(match.snapshot().players[2]!.connected).toBe(true);
  });
  it("requires exact seed READY and stops failed preparation", () => {
    const endpoints = [new Endpoint(), new Endpoint()];
    const match = new HostedMatch(BLOCKS_HOSTED, endpoints.map((endpoint, i) => ({ id: String(i), endpoint })), () => 42);
    match.start(0); match.tick(0); endpoints.forEach(e => e.drain());
    match.receive(0, msg(3, 1, 41), 1); match.receive(1, msg(3, 1, 42), 1);
    match.tick(9999); expect(match.phase).toBe("preparing"); match.tick(10000); expect(match.phase).toBe("aborted");
  });
  it("rejects oversized rosters and duplicate seat identities", () => {
    const players = Array.from({ length: 17 }, (_, i) => ({ id: String(i), endpoint: new Endpoint() }));
    expect(() => new HostedMatch(BLOCKS_HOSTED, players, () => 1)).toThrow();
    expect(() => new HostedMatch(BLOCKS_HOSTED, [players[0]!, players[0]!], () => 1)).toThrow();
  });
});
