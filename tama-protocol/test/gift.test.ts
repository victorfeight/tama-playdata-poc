import { describe, expect, it } from "vitest";
import { buildGiftItemPayload, buildGiftVersionPayload, parseGiftPayload } from "../src/gift";

describe("retained Gift payload format", () => {
  it("keeps version and item distinct, including nonzero buffer offsets", () => {
    expect(parseGiftPayload(buildGiftVersionPayload())).toEqual({ phase: "version", version: 1 });
    const frame = new Uint8Array([99, 0x8b, 0x13, 88]);
    expect(parseGiftPayload(frame.subarray(1, 3))).toEqual({ phase: "item", itemId: 5003 });
    expect([...buildGiftItemPayload(5003)]).toEqual([0x8b, 0x13]);
  });
  it("rejects incomplete payloads without interpreting them as items", () => {
    for (const n of [0, 1, 3, 5]) expect(() => parseGiftPayload(new Uint8Array(n))).toThrow();
    expect(() => buildGiftItemPayload(-1)).toThrow();
    expect(() => buildGiftVersionPayload(2 ** 32)).toThrow();
  });
});
