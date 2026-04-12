import { describe, expect, it } from "vitest";
import { parseGhost } from "../src/ghost";

describe("ghost parser", () => {
  it("parses a minimal padded header shape", () => {
    const data = new Uint8Array(0x20000);
    data.fill(0xff);
    const view = new DataView(data.buffer);
    view.setUint32(0x08, 0, true);
    view.setUint16(0x0c, 4017, true);
    view.setUint16(0x0e, 4800, true);
    view.setUint8(0x10, 0xff);
    view.setUint16(0xfc, 5, true);
    view.setUint32(0x10c, 0x20000, true);
    const parsed = parseGhost(data);
    expect(parsed.charaId).toBe(4017);
    expect(parsed.actualCharaId).toBe(4800);
    expect(parsed.stage).toBe(5);
  });
});
