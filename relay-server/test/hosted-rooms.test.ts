import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { GameRoomHub } from "../src/game-rooms";
import { Tet3Session } from "../../tama-protocol/src/tet3-session";
class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN; bufferedAmount = 0;
  messages: { data: string | Uint8Array; binary: boolean }[] = [];
  closeCode: number | undefined;
  send(data: string | Uint8Array, options?: { binary: boolean }) { this.messages.push({ data, binary: options?.binary ?? false }); }
  close(code: number) { this.closeCode = code; this.readyState = WebSocket.CLOSED; this.emit("close"); }
  terminate() { this.close(1006); } ping() { this.emit("pong"); }
  get ws() { return this as unknown as WebSocket; }
  snapshot() { return this.messages.filter(m => !m.binary).map(m => JSON.parse(m.data.toString())).filter(m => m.type === "game-room").at(-1)!; }
  control(control: object) { this.emit("message", Buffer.from(JSON.stringify(control)), false); }
}
let hub: GameRoomHub; let now = 0;
afterEach(() => { hub?.close(); vi.useRealTimers(); });
function setup() { now = 0; vi.useFakeTimers(); hub = new GameRoomHub(() => now); }
const advance = (ms = 25) => { now += ms; vi.advanceTimersByTime(ms); };
describe("hosted room membership and transport", () => {
  it("isolates credentials, rejects seat 17/app mismatch, transfers owner and ignores superseded sockets", () => {
    setup(); const a = hub.create("Fern", "public", "blocks"), sa = new Socket();
    expect(hub.list()).toEqual([]); hub.attach(a.code, a.token, sa.ws);
    const players = [a, ...Array.from({ length: 15 }, (_, i) => hub.join(a.code, `Player ${i}`, "blocks"))];
    expect(new Set(players.map(p => p.token)).size).toBe(16);
    expect(() => hub.join(a.code, "Overflow", "blocks")).toThrow("16");
    expect(() => hub.join(a.code, "Mismatch", "pocket-puzzle")).toThrow("different game");
    expect(hub.list()).toEqual([]);
    const denied = new Socket(); hub.attach(a.code, "bad-token", denied.ws); expect(denied.closeCode).toBe(4401);
    const sb = new Socket(); hub.attach(a.code, players[1]!.token, sb.ws);
    const replacement = new Socket(); hub.attach(a.code, a.token, replacement.ws);
    sa.control({ type: "adapter", connected: true }); expect(replacement.snapshot().members[0].adapter).toBe(false);
    expect(sa.closeCode).toBe(4001); hub.leave(a.code, a.token);
    expect(sb.snapshot().owner).toBe(players[1]!.memberId);
    expect(JSON.stringify(sb.snapshot())).not.toContain(players[1]!.token);
  });
  it("handshakes independent toy sessions, starts only for owner with all ready, and forbids mid-match replacement", () => {
    setup(); const a = hub.create("A", "private", "blocks"), b = hub.join(a.code, "B", "blocks");
    const sockets = [new Socket(), new Socket()];
    hub.attach(a.code, a.token, sockets[0]!.ws); hub.attach(a.code, b.token, sockets[1]!.ws);
    const received = [0, 0];
    const toys = sockets.map((s, i) => new Tet3Session(4, 100 + i, 0, wire => s.emit("message", Buffer.from(wire), true), () => {}, () => {}));
    sockets.forEach(s => s.control({ type: "adapter", connected: true }));
    const step = () => {
      advance(); sockets.forEach((s, i) => {
        const messages = s.messages.slice(received[i]); received[i] = s.messages.length;
        for (const m of messages) if (m.binary) toys[i]!.receive(m.data as Uint8Array, now);
        toys[i]!.poll(now);
      });
    };
    for (let i = 0; i < 100; i++) step();
    expect(toys.every(t => t.ready)).toBe(true); expect(toys[0]!.session).not.toBe(toys[1]!.session);
    expect(sockets[0]!.snapshot().members.every((m: any) => m.toyReady)).toBe(true);
    sockets.forEach(s => s.control({ type: "ready", ready: true }));
    sockets[1]!.control({ type: "start" }); expect(sockets[1]!.messages.at(-1)!.data.toString()).toContain("Only the room owner");
    // Reproduce the browser race: ready was displayed, then a heartbeat went
    // out before the click. Do not pump toy ACKs until after start is accepted.
    const beforeHeartbeat = sockets[0]!.messages.filter(m => m.binary).length;
    advance(1000);
    expect(sockets[0]!.messages.filter(m => m.binary).length).toBeGreaterThan(beforeHeartbeat);
    expect(sockets[0]!.snapshot().canStart).toBe(true);
    sockets[0]!.control({ type: "start" }); expect(sockets[0]!.snapshot().match.phase).toBe("preparing");
    expect(() => hub.join(a.code, "Late", "blocks")).toThrow("started");
    const replacement = new Socket(); hub.attach(a.code, a.token, replacement.ws);
    expect(replacement.snapshot().match.phase).toBe("aborted");
    replacement.control({ type: "adapter", connected: true });
    expect(replacement.messages.at(-1)!.data.toString()).toContain("Wait for a new match");
    // The aborted toy can stop before ACKing type 12. Its pending queue must
    // not strand the room: reset ends those sessions instead of waiting forever.
    advance();
    replacement.control({ type: "reset" });
    expect(replacement.snapshot().match).toBeUndefined();
    expect(replacement.snapshot().members.every((m: any) => !m.toyReady && !m.ready)).toBe(true);
  });
  it("bounds traffic and expires abandoned reservations without touching other rooms", () => {
    setup(); const a = hub.create("A", "public", "blocks"), b = hub.create("B", "public", "blocks");
    const socket = new Socket(); hub.attach(b.code, b.token, socket.ws);
    advance(60001); expect(() => hub.join(a.code, "Late", "blocks")).toThrow("closed");
    // The connected toy's pong deadline is separate from idle seat expiry.
    const c = hub.create("C", "private", "blocks"), sc = new Socket(); hub.attach(c.code, c.token, sc.ws);
    sc.emit("message", Buffer.alloc(8193), true); expect(sc.closeCode).toBe(1008);
  });
});

describe("named direct game rooms", () => {
  it("lists names and mode, limits two seats, rejects wrong mode and gates exact peer bytes on both adapters", () => {
    setup(); const a = hub.create("Fern", "public", "pocket-puzzle", "direct"), sa = new Socket();
    hub.attach(a.code, a.token, sa.ws);
    expect(hub.list()[0]).toMatchObject({ nickname: "Fern", mode: "direct", capacity: 2, count: 1 });
    expect(() => hub.join(a.code, "Wrong", "pocket-puzzle")).toThrow("Versus");
    const b = hub.join(a.code, "Willow", "pocket-puzzle", "direct"), sb = new Socket();
    hub.attach(a.code, b.token, sb.ws);
    expect(() => hub.join(a.code, "Third", "pocket-puzzle", "direct")).toThrow("2 players");
    expect(hub.list()).toEqual([]);
    sa.control({ type: "adapter", connected: true });
    sa.emit("message", Buffer.from([1, 2]), true); expect(sb.messages.some(m => m.binary)).toBe(false);
    sb.control({ type: "adapter", connected: true });
    const bytes = Buffer.from([0, 255, 1, 2]); sa.emit("message", bytes, true);
    expect(sb.messages.at(-1)).toEqual({ data: bytes, binary: true });
    sb.emit("message", bytes.subarray(1), true);
    expect(sa.messages.at(-1)).toEqual({ data: bytes.subarray(1), binary: true });
    expect(sa.snapshot().canStart).toBe(false);
    sa.control({ type: "start" }); expect(sa.messages.at(-1)!.data.toString()).toContain("Choose Versus");
    expect(JSON.stringify(sa.snapshot())).not.toContain(b.token);
  });
  it("stops both adapters after peer loss/replacement, requires fresh opt-in and applies backpressure", () => {
    setup(); const a = hub.create("A", "private", "blocks", "direct"), b = hub.join(a.code, "B", "blocks", "direct");
    const sa = new Socket(), sb = new Socket(); hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    for (const s of [sa, sb]) s.control({ type: "adapter", connected: true });
    sb.control({ type: "adapter", connected: false });
    expect(sa.snapshot().members.every((m: any) => !m.adapter)).toBe(true);
    expect(sa.snapshot().members[0].reason).toContain("friend disconnected");
    const count = sb.messages.length;
    sa.emit("message", Buffer.from([1]), true); expect(sb.messages.length).toBe(count);
    for (const s of [sa, sb]) s.control({ type: "adapter", connected: true });
    sb.bufferedAmount = 65537; sa.emit("message", Buffer.from([2]), true);
    expect(sb.closeCode).toBe(1013); expect(sa.snapshot().members[0].adapter).toBe(false);
    const replacement = new Socket(); hub.attach(a.code, b.token, replacement.ws);
    expect(replacement.snapshot().members.every((m: any) => !m.adapter)).toBe(true);
    sa.control({ type: "adapter", connected: true }); replacement.control({ type: "adapter", connected: true });
    sa.emit("message", Buffer.from([3]), true);
    expect(replacement.messages.at(-1)).toEqual({ data: Buffer.from([3]), binary: true });
  });
});
