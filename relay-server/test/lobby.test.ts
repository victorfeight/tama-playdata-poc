import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { LobbyHub } from "../src/lobby";
class Socket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  messages: { data: string | Buffer; binary: boolean }[] = [];
  closeCode: number | undefined;
  send(data: string | Buffer, options?: { binary: boolean }) { this.messages.push({ data, binary: options?.binary ?? false }); }
  close(code: number) { this.closeCode = code; this.readyState = WebSocket.CLOSED; this.emit("close"); }
  terminate() { this.close(1006); }
  ping() {}
  get ws() { return this as unknown as WebSocket; }
  snapshot() { return JSON.parse(this.messages.filter(m => !m.binary).at(-1)!.data.toString()); }
}
let now = 0;
let hub: LobbyHub;
afterEach(() => { hub?.close(); vi.useRealTimers(); });
const setup = () => { now = 0; hub = new LobbyHub(() => now); };
describe("Playdate lobby membership", () => {
  it("coordinates fresh receiver confirmation without pretending to press B or detect a successful exchange", () => {
    vi.useFakeTimers(); setup();
    const a = hub.create("A", "private"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket();
    hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    const control = (s: Socket, value: object) => s.emit("message", Buffer.from(JSON.stringify(value)), false);
    for (const s of [sa, sb]) control(s, { type: "adapter", connected: true, starterChoice: true });
    const prompt = (s: Socket, action: string) => control(s, { type: "start-prompt", action });
    prompt(sa, "prepare"); prompt(sb, "ready"); // Wrong roles.
    expect(sa.snapshot().startPrompt).toBeUndefined();
    prompt(sa, "ready"); // Not yet requested.
    expect(sa.snapshot().startPrompt).toBeUndefined();
    prompt(sb, "prepare");
    expect(sa.snapshot().startPrompt).toBe("prepare");
    prompt(sa, "ready");
    expect(sb.snapshot()).toMatchObject({ startPrompt: "ready", readyForMs: 8000 });
    expect(sb.messages.some(m => m.binary)).toBe(false);
    now += 8000; vi.advanceTimersByTime(8000);
    expect(sa.snapshot().startPrompt).toBe("prepare");
    prompt(sa, "ready");
    sb.emit("message", Buffer.from("PKT 2\r\n"), true);
    expect(sa.snapshot().startPrompt).toBe("started");
    expect(sa.messages.at(-1)).toEqual({ data: Buffer.from("PKT 2\r\n"), binary: true });
    now += 8000; vi.advanceTimersByTime(8000);
    expect(sa.snapshot().startPrompt).toBe("started");
    prompt(sb, "prepare"); prompt(sa, "ready");
    control(sb, { type: "starter", memberId: a.memberId });
    expect(sa.snapshot().startPrompt).toBeUndefined();
    prompt(sa, "prepare"); prompt(sb, "ready");
    control(sb, { type: "adapter", connected: false, starterChoice: true });
    expect(sa.snapshot().startPrompt).toBeUndefined();
    prompt(sa, "prepare"); // No menu readiness while an adapter is disconnected.
    expect(sa.snapshot().startPrompt).toBeUndefined();
    control(sb, { type: "adapter", connected: true, starterChoice: true });
    prompt(sa, "prepare"); prompt(sb, "ready");
    sb.close(1000);
    expect(sa.snapshot().startPrompt).toBeUndefined();
  });
  it("shares a framed abort, preserves every raw byte, and requires fresh receiver readiness", async () => {
    setup();
    const a = hub.create("A", "private"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket(); hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    const control = (s: Socket, value: object) => s.emit("message", Buffer.from(JSON.stringify(value)), false);
    for (const s of [sa, sb]) control(s, { type: "adapter", connected: true, starterChoice: true });
    control(sb, { type: "start-prompt", action: "prepare" });
    control(sa, { type: "start-prompt", action: "ready" });
    const wire = Buffer.from("PKT 2\r\nPKT 2\r\nPKT 2\r\nPKT 2\r\nCAN\r\n");
    sb.emit("message", wire, true);
    expect(sa.messages.filter(m => m.binary).at(-1)?.data).toEqual(wire);
    await vi.waitFor(() => expect(sa.snapshot().outcome).toBe("interrupted"));
    expect(sa.snapshot().startPrompt).toBe("prepare");
    expect(sb.snapshot().outcome).toBe("interrupted");
    expect(sa.snapshot().starterId).toBe(b.memberId);
    // Nothing reopens the eight-second window until the receiver confirms again.
    expect(sa.snapshot().readyForMs).toBeUndefined();
    control(sa, { type: "start-prompt", action: "ready" });
    expect(sa.snapshot()).toMatchObject({ startPrompt: "ready", outcome: "exchanging", readyForMs: 8000 });
  });
  it("ignores queued evidence from an attempt abandoned by a starter switch", async () => {
    setup();
    const a = hub.create("A", "private"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket(); hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    const control = (s: Socket, value: object) => s.emit("message", Buffer.from(JSON.stringify(value)), false);
    for (const s of [sa, sb]) control(s, { type: "adapter", connected: true, starterChoice: true });
    control(sb, { type: "start-prompt", action: "prepare" }); control(sa, { type: "start-prompt", action: "ready" });
    sb.emit("message", Buffer.from("PKT 2\r\nCAN\r\n"), true);
    control(sa, { type: "starter", memberId: a.memberId });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(sa.snapshot().outcome).toBeUndefined(); expect(sa.snapshot().starterId).toBe(a.memberId);
  });
  it("shares one starter, preserves reconnects, and never injects selection into UART", () => {
    setup();
    const a = hub.create("A", "private"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket();
    hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    const capable = (s: Socket) => s.emit("message", Buffer.from(JSON.stringify({ type: "adapter", connected: true, starterChoice: true })), false);
    const choose = (s: Socket, memberId: string) => s.emit("message", Buffer.from(JSON.stringify({ type: "starter", memberId })), false);
    expect(sa.snapshot().canChooseStarter).toBe(false);
    capable(sa); capable(sb);
    expect(sa.snapshot()).toMatchObject({ starterId: b.memberId, canChooseStarter: true });
    choose(sb, a.memberId);
    expect(sa.snapshot().starterId).toBe(a.memberId);
    expect(sb.snapshot().starterId).toBe(a.memberId);
    choose(sa, "another-room-member");
    expect(sa.snapshot().starterId).toBe(a.memberId);
    expect(sb.messages.some(m => m.binary)).toBe(false);
    // Conflicting requests are serialized by the room, not independently flipped.
    choose(sa, b.memberId); choose(sb, a.memberId);
    expect(sa.snapshot().starterId).toBe(sb.snapshot().starterId);
    sa.close(1000);
    const rejoined = new Socket(); hub.attach(a.code, a.token, rejoined.ws); capable(rejoined);
    expect(rejoined.snapshot()).toMatchObject({ starterId: a.memberId, canChooseStarter: true });
    choose(sa, b.memberId); // Superseded socket cannot change the choice.
    expect(rejoined.snapshot().starterId).toBe(a.memberId);
    hub.leave(a.code, a.token);
    expect(sb.snapshot().starterId).toBeUndefined();
    const c = hub.join(a.code, "C"), sc = new Socket(); hub.attach(a.code, c.token, sc.ws); capable(sc);
    expect(sc.snapshot().starterId).toBe(b.memberId);
    // A cached browser without this UI must keep the historical instructions.
    sc.emit("message", Buffer.from('{"type":"adapter","connected":false}'), false);
    expect(sb.snapshot().canChooseStarter).toBe(false);
    choose(sb, c.memberId);
    expect(sb.snapshot().starterId).toBe(b.memberId);
  });
  it("lets old desktop guests reconnect without disclosing or taking the browser host seat", () => {
    setup();
    const host = hub.create("Browser host", "private"), sh = new Socket();
    hub.attach(host.code, host.token, sh.ws);
    const guest = hub.joinLegacy(host.code);
    expect(guest.token).not.toBe(host.token);
    expect(hub.joinLegacy(host.code)).toEqual(guest);
    for (const [role, token] of [["a", guest.token], ["b", host.token]]) {
      const denied = new Socket(); hub.attachLegacy(host.code, role!, token, denied.ws);
      expect(denied.closeCode).toBe(4401);
    }
    const desktop = new Socket(); hub.attachLegacy(host.code, "b", guest.token, desktop.ws);
    expect(desktop.messages.map(m => m.data)).toEqual(["peer connected"]);
    expect(sh.snapshot().members[1]).toMatchObject({ slot: 1, adapterConnected: null, connected: true });
    sh.emit("message", Buffer.from('{"type":"adapter","connected":true}'), false);
    expect(desktop.messages.map(m => m.data)).toEqual(["peer connected"]);
    sh.emit("message", Buffer.from([0, 255, 6]), true);
    desktop.emit("message", Buffer.from([17, 42]), true);
    expect(desktop.messages.at(-1)).toEqual({ data: Buffer.from([0, 255, 6]), binary: true });
    expect(sh.messages.at(-1)).toEqual({ data: Buffer.from([17, 42]), binary: true });
    sh.close(1000);
    expect(desktop.messages.at(-1)?.data).toBe("peer disconnected");
    hub.attach(host.code, host.token, new Socket().ws);
    expect(desktop.messages.at(-1)?.data).toBe("peer connected");
    desktop.close(1000);
    expect(hub.joinLegacy(host.code)).toEqual(guest);
    const replacement = new Socket(); hub.attachLegacy(host.code, "b", guest.token, replacement.ws);
    expect(replacement.messages.map(m => m.data)).toEqual(["peer connected"]);
  });
  it("does not let legacy joining replace a reserved browser guest", () => {
    setup();
    const host = hub.create("Host", "private"), guest = hub.join(host.code, "Browser friend");
    expect(() => hub.joinLegacy(host.code)).toThrow("full");
    hub.leave(host.code, guest.token);
    expect(hub.joinLegacy(host.code).token).not.toBe(host.token);
  });
  it("lists only public, connected, available rooms without exposing credentials", () => {
    setup();
    const privateRoom = hub.create("Private", "private"), publicRoom = hub.create("<b>Fern</b>", "public");
    expect(hub.list()).toEqual([]);
    hub.attach(privateRoom.code, privateRoom.token, new Socket().ws);
    const socket = new Socket(); hub.attach(publicRoom.code, publicRoom.token, socket.ws);
    expect(hub.list()).toEqual([{ code: publicRoom.code, nickname: "<b>Fern</b>", count: 1, capacity: 2 }]);
    expect(JSON.stringify(socket.snapshot())).not.toContain(publicRoom.token);
    const guest = hub.join(publicRoom.code, "Friend");
    expect(guest.token).not.toBe(publicRoom.token);
    expect(hub.list()).toEqual([]);
    expect(() => hub.join(publicRoom.code, "Third")).toThrow("full");
    hub.leave(publicRoom.code, guest.token);
    expect(hub.list()).toHaveLength(1);
  });
  it("relays only binary data, isolates rooms, and reports adapter state separately", () => {
    setup();
    const a = hub.create("A", "public"), b = hub.join(a.code, "B"), c = hub.create("C", "private");
    const sa = new Socket(), sb = new Socket(), sc = new Socket();
    hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws); hub.attach(c.code, c.token, sc.ws);
    sa.emit("message", Buffer.from('{"type":"adapter","connected":true}'), false);
    expect(sb.snapshot().members.find((m: any) => m.id === a.memberId)).toMatchObject({ connected: true, adapterConnected: true });
    expect(sb.snapshot().members.find((m: any) => m.id === b.memberId).adapterConnected).toBe(false);
    sa.emit("message", Buffer.from([0, 255, 17, 42]), true);
    expect(sb.messages.filter(m => m.binary).map(m => [...m.data as Buffer])).toEqual([[0, 255, 17, 42]]);
    expect(sc.messages.filter(m => m.binary)).toHaveLength(0);
    sa.emit("message", Buffer.from("not serial"), false);
    expect(sb.messages.filter(m => m.binary)).toHaveLength(1);
  });
  it("guards credentials, socket replacement and stale close/data", () => {
    setup();
    const a = hub.create("A", "public"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket(); hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    const denied = new Socket(); hub.attach(a.code, "wrong", denied.ws); expect(denied.closeCode).toBe(4404);
    const replacement = new Socket(); hub.attach(a.code, a.token, replacement.ws); expect(sa.closeCode).toBe(4001);
    sa.emit("message", Buffer.from([1]), true); sa.emit("close");
    expect(sb.messages.filter(m => m.binary)).toHaveLength(0);
    replacement.emit("message", Buffer.from([2]), true);
    expect([...sb.messages.filter(m => m.binary).at(-1)!.data as Buffer]).toEqual([2]);
    expect(sb.snapshot().members.find((m: any) => m.id === a.memberId)).toMatchObject({ connected: true, connection: 2 });
  });
  it("expires disconnected seats without changing the surviving player's role", () => {
    setup();
    const a = hub.create("A", "public"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket(); hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    sa.close(1000); expect(sb.snapshot().members[0]).toMatchObject({ connected: false, adapterConnected: false });
    expect(() => hub.join(a.code, "C")).toThrow("full");
    now = 60_001; hub.sweep(); expect(sb.snapshot().members).toHaveLength(1); expect(sb.snapshot().members[0].slot).toBe(1);
    const c = hub.join(a.code, "C"); const sc = new Socket(); hub.attach(a.code, c.token, sc.ws);
    expect(sc.snapshot().members.find((m: any) => m.id === c.memberId).slot).toBe(0);
    hub.leave(a.code, b.token); hub.leave(a.code, c.token); expect(() => hub.join(a.code, "D")).toThrow("closed");
  });
  it("bounds abandoned rooms, nicknames, control traffic and backpressure", () => {
    setup();
    expect(() => hub.create("\u0000\u200b", "public")).toThrow("nickname");
    expect(() => hub.create("a".repeat(21), "public")).toThrow("nickname");
    const a = hub.create("A", "public"), b = hub.join(a.code, "B");
    const sa = new Socket(), sb = new Socket(); hub.attach(a.code, a.token, sa.ws); hub.attach(a.code, b.token, sb.ws);
    sb.bufferedAmount = 1024 * 1024 + 1;
    sa.emit("message", Buffer.from([1]), true); expect(sb.closeCode).toBe(1013);
    for (let i = 0; i < 21; i++) sa.emit("message", Buffer.from("{}"), false);
    expect(sa.closeCode).toBe(1008);
    for (let i = 0; i < 127; i++) hub.create("Reserved", "private");
    expect(() => hub.create("Overflow", "private")).toThrow("busy");
    now = 60_001; hub.sweep(); expect(() => hub.create("Fresh", "private")).not.toThrow();
  });
});
