import { afterEach, describe, expect, it, vi } from "vitest";
import { SerialBridge } from "../../web-client/src/serial-bridge";
import { WebSerialTransport } from "../../tama-protocol/src/transport-webserial";

class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  binaryType = "";
  sent: Uint8Array[] = [];
  send(data: Uint8Array) { this.sent.push(data.slice()); }
  close() { this.readyState = 3; }
}
function fixture() {
  vi.stubGlobal("WebSocket", Socket);
  const reads: { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }[] = [];
  const serial = { name: "test", read: vi.fn(() => new Promise<Uint8Array>((resolve, reject) => reads.push({ resolve, reject }))), write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const bridges: SerialBridge[] = [];
  function attach() {
    const socket = new Socket();
    const error = vi.fn();
    const bridge = new SerialBridge(serial, socket as unknown as WebSocket, { error });
    bridges.push(bridge);
    bridge.start();
    return { socket, bridge, error };
  }
  return { serial, reads, attach, stop: () => bridges.forEach(b => b.stop()) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
afterEach(() => vi.unstubAllGlobals());

describe("serial bridge room lifecycle", () => {
  it("delivers the first read after repeated reconnects to the current room exactly once", async () => {
    const f = fixture();
    try {
      const old = f.attach(); old.bridge.stop();
      const middle = f.attach(); middle.bridge.stop();
      const current = f.attach();
      expect(f.serial.read).toHaveBeenCalledTimes(1);
      f.reads.shift()!.resolve(new TextEncoder().encode("PKT 0\r\n"));
      await tick();
      expect(old.socket.sent).toEqual([]);
      expect(middle.socket.sent).toEqual([]);
      expect(current.socket.sent.map(b => [...b])).toEqual([[80, 75, 84, 32, 48, 13, 10]]);
      expect(f.reads).toHaveLength(1);
    } finally { f.stop(); }
  });
  it("discards offline bytes, stops reading, and resumes without replay", async () => {
    const f = fixture();
    try {
      f.attach().bridge.stop();
      f.reads.shift()!.resolve(Uint8Array.of(99)); await tick();
      expect(f.reads).toHaveLength(0);
      const current = f.attach();
      f.reads.shift()!.resolve(Uint8Array.of(42)); await tick();
      expect(current.socket.sent.map(b => [...b])).toEqual([[42]]);
    } finally { f.stop(); }
  });
  it("reports a pending-read failure only to the current owner", async () => {
    const f = fixture();
    try {
      const old = f.attach(); old.bridge.stop();
      const current = f.attach();
      f.reads.shift()!.reject(new Error("unplugged")); await tick();
      expect(old.error).not.toHaveBeenCalled();
      expect(current.error).toHaveBeenCalledTimes(1);
      expect(current.bridge.isClosed).toBe(true);
    } finally { f.stop(); }
  });
  it("ignores text and cannot write a Blob resolved after stop", async () => {
    const f = fixture();
    try {
      const current = f.attach();
      current.socket.dispatchEvent(new MessageEvent("message", { data: "peer connected" }));
      let resolve!: (data: ArrayBuffer) => void;
      const data = { arrayBuffer: () => new Promise<ArrayBuffer>(r => { resolve = r; }) };
      current.socket.dispatchEvent(new MessageEvent("message", { data }));
      current.bridge.stop(); resolve(Uint8Array.of(9).buffer); await tick();
      expect(f.serial.write).not.toHaveBeenCalled();
    } finally { f.stop(); }
  });
  it("treats serial EOF as a terminal error instead of polling an ended stream", async () => {
    const port = {
      readable: new ReadableStream<Uint8Array>({ start(c) { c.close(); } }),
      writable: new WritableStream<Uint8Array>(),
      open: async () => {}, close: async () => {}, getInfo: () => ({})
    };
    const serial = new WebSerialTransport(port);
    await serial.open();
    await expect(serial.read()).rejects.toThrow(/closed/i);
    await serial.close();
  });
});
