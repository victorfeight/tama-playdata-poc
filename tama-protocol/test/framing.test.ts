import { describe, expect, it } from "vitest";
import { createChunk, parseChunk } from "../src/framing";
import { PacketType } from "../src/packets";

describe("chunk framing", () => {
  it("round trips a payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk = createChunk(0x12345678, PacketType.PLAYDATE, 7, payload);
    const parsed = parseChunk(chunk);
    expect(parsed.sessionId).toBe(0x12345678);
    expect(parsed.msgType).toBe(PacketType.PLAYDATE);
    expect(parsed.chunkIndex).toBe(7);
    expect([...parsed.payload]).toEqual([...payload]);
  });
});
