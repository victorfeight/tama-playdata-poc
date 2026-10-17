import { describe, expect, it } from "vitest";
import { PlaydateOutcomeObserver, type PlaydateSide } from "../src/playdate-outcome";
import { TcpObserver } from "../src/tcp-observer";
import { tcpCrypt } from "../src/tcp-crypto";
import { createChunk } from "../src/framing";
const text = (s: string) => new TextEncoder().encode(s);
async function wire(payload: number[], type = 1) {
  const nonce = new Uint8Array([1, 2, 3, 4]);
  return new Uint8Array([...nonce, ...await tcpCrypt(nonce, createChunk(42, type, 0, new Uint8Array(payload)))]);
}
async function packet(o: PlaydateOutcomeObserver, payload: number[], side: PlaydateSide = 0, type = 1) {
  o.push(side, text(`PKT ${payload.length}\r\n`));
  o.push(side === 0 ? 1 : 0, text("ACK\r\n"));
  o.push(side, await wire(payload, type));
  o.push(side === 0 ? 1 : 0, text("ACK\r\n"));
  await o.settled();
}
describe("passive Playdate outcome", () => {
  it("recognizes the native unanswered-PKT sequence, including single-byte fragmentation", async () => {
    const changes: string[] = [], o = new PlaydateOutcomeObserver(s => changes.push(s));
    for (const b of text("PKT 2\r\nPKT 2\r\nPKT 2\r\nPKT 2\r\n")) o.push(0, new Uint8Array([b]));
    await o.settled(); expect(changes).toEqual([]);
    for (const b of text("CAN\r\n")) o.push(0, new Uint8Array([b]));
    await o.settled(); expect(changes).toEqual(["interrupted"]);
  });
  it("copies queued Node buffers before the sender can reuse them", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    const buffer = Buffer.from("PKT 2\r\nCAN\r\n");
    o.push(0, buffer); buffer.fill(0); await o.settled();
    expect(o.state).toBe("interrupted");
  });
  it("ignores unsolicited CAN, retry requests, and silence", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    o.push(0, text("CAN\r\n")); o.push(1, text("NAK\r\nENQ 0\r\n"));
    await o.settled(); expect(o.state).toBe("exchanging");
    // No timer exists: quiet animations or a silent local failure remain unknown.
  });
  it("handles receiver CAN and retires completed transport requests", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    await packet(o, [0, 0, 0, 0]); expect(o.state).toBe("result-observed");
    o.push(1, text("CAN\r\n")); await o.settled(); expect(o.state).toBe("result-observed");
    o.push(0, text("PKT 4\r\n")); o.push(1, text("CAN\r\n"));
    await o.settled(); expect(o.state).toBe("interrupted");
  });
  it("does not treat parser garbage, resync warnings or an embedded CAN as failure", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    o.push(0, text("PKT 100\r\n")); o.push(1, text("ACK\r\n"));
    o.push(0, new Uint8Array([...text("CAN\r\n"), ...new Uint8Array(111)]));
    o.push(0, text("\r\nCAN\r\n"));
    await o.settled(); expect(o.state).toBe("exchanging");
  });
  it("records a result without declaring completion or persistence", async () => {
    for (const result of [0, 1, 2, 3]) {
      const o = new PlaydateOutcomeObserver(() => {});
      await packet(o, [result, 0, 0, 0]); expect(o.state).toBe("result-observed");
      o.push(0, text("SYNC 2\r\n")); o.push(1, text("SYNC 2\r\n"));
      await o.settled(); expect(o.state).toBe("result-observed");
    }
  });
  it("keeps a breeding decline distinct from transfer failure", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    await packet(o, [0, 0, 1, 0]);
    o.push(1, text("BREED 0\r\nSYNC 1\r\n")); await o.settled();
    await packet(o, [0, 0, 1, 0]); expect(o.state).toBe("result-observed");
  });
  it("requires accepted result plus both SYNC 2 directions and still does not claim saved", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    await packet(o, [0, 0, 1, 0]); o.push(1, text("BREED 1\r\nSYNC 1\r\n"));
    await o.settled(); expect(o.state).toBe("breeding");
    await packet(o, [4, 0, 1, 0]);
    o.push(0, text("SYNC 2\r\nSYNC 2\r\n")); await o.settled(); expect(o.state).toBe("breeding");
    o.push(1, text("SYNC 2\r\n")); await o.settled(); expect(o.state).toBe("settling");
  });
  it("rejects session setters, gifts, impossible results and flags", async () => {
    const o = new PlaydateOutcomeObserver(() => {});
    await packet(o, [0, 0, 0, 0], 0, 0x11);
    await packet(o, [0, 0, 0, 0], 0, 2);
    await packet(o, [5, 0, 0, 0]); await packet(o, [0, 0, 2, 0]);
    expect(o.state).toBe("exchanging");
  });
  it("cannot let an old asynchronous observer finish a replacement attempt", async () => {
    const changes: string[] = [], o = new PlaydateOutcomeObserver(s => changes.push(s));
    o.push(0, text("PKT 2\r\nCAN\r\n")); o.stop(); await o.settled(); expect(changes).toEqual([]);
    const packets: unknown[] = [], obs = new TcpObserver({ packet: p => packets.push(p) });
    obs.push(text("PKT 4\r\n")); obs.push(await wire([0, 0, 0, 0])); obs.reset();
    await obs.settled(); expect(packets).toEqual([]);
  });
});
