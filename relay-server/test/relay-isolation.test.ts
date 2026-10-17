import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { RelayHub } from "../src/relay";
import type { SessionStore } from "../src/sessions";

class Socket extends EventEmitter {
  readyState = WebSocket.OPEN;
  binaryType = "";
  send = vi.fn();
  ping = vi.fn();
  // Model asynchronous close: the old socket can still emit buffered messages.
  close() {}
}
describe("relay device-byte isolation", () => {
  it("forwards only binary data from the current room occupant", () => {
    const store = { touch: vi.fn(), addBytes: vi.fn() };
    const hub = new RelayHub(store as unknown as SessionStore);
    const old = new Socket(), peer = new Socket(), replacement = new Socket();
    const attach = (role: "a" | "b", ws: Socket) => hub.attach("ABC123", role, ws as unknown as WebSocket);
    try {
      attach("a", old); attach("b", peer); attach("a", replacement);
      peer.send.mockClear();
      old.emit("message", Buffer.from([99]), true);
      replacement.emit("message", Buffer.from("not UART data"), false);
      replacement.emit("message", Buffer.from([1, 2, 3]), true);
      expect(peer.send.mock.calls).toEqual([[Buffer.from([1, 2, 3])]]);
      old.emit("close");
      expect(hub.activeCount("ABC123")).toBe(2);
    } finally {
      old.emit("close"); replacement.emit("close"); peer.emit("close");
    }
  });
});
