import { describe, expect, it } from "vitest";
import { crc32, encodeTet3, Tet3Observer } from "../../web-client/src/games/tet3";

const hello = { session: 0, sequence: 0, type: 1, round: 0, a: 1978140483, b: 3, c: 0 };
// Exact captured device output, independent of this source encoder.
const wire = Uint8Array.from(Buffer.from(
  "000554455433010101010101010201010101010101064307e8750301010101010105edd27d4d00", "hex"));

describe("captured TET3 interface", () => {
  it("matches captured bytes and standard CRC32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(encodeTet3(hello)).toEqual(wire);
  });
  it("accepts every serial/WebSocket fragmentation boundary", () => {
    for (let split = 0; split <= wire.length; split++) {
      const observer = new Tet3Observer();
      expect([...observer.push(wire.slice(0, split)), ...observer.push(wire.slice(split))]).toEqual([hello]);
    }
    const observer = new Tet3Observer();
    expect([...wire].flatMap(b => observer.push(Uint8Array.of(b)))).toEqual([hello]);
  });
  it("resynchronizes after corrupt, oversized and malformed input", () => {
    const observer = new Tet3Observer(), corrupt = wire.slice();
    corrupt[25] = 9;
    expect(observer.push(corrupt)).toEqual([]);
    expect(observer.push(new Uint8Array(10000).fill(1))).toEqual([]);
    expect(observer.push(Uint8Array.of(0, 40, 1, 0))).toEqual([]);
    expect(observer.invalid).toBe(3);
    expect(observer.push(wire)).toEqual([hello]);
  });
  it("accepts combined frames without rewriting packet semantics", () => {
    const start = { session: 1251563115, sequence: 2, type: 4, round: 1, a: 221619591, b: 258, c: 0 };
    const observer = new Tet3Observer();
    expect(observer.push(Uint8Array.from([...wire, ...encodeTet3(start)]))).toEqual([hello, start]);
    observer.push(wire.slice(0, 20)); observer.reset();
    expect(observer.push(wire)).toEqual([hello]);
  });
});
