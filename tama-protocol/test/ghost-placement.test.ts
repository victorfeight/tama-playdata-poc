import { describe, expect, it } from "vitest";
import { ghostPlacement } from "../src/ghost-placement";

function ghost(): Uint8Array {
  const bytes = new Uint8Array(0x20000);
  const view = new DataView(bytes.buffer);
  for (const [i, x, y] of [[0, 12, 20], [1, 9, 17], [2, 14, 23]]) {
    view.setInt16(0x670 + i * 22, x, true);
    view.setInt16(0x670 + i * 22 + 2, y, true);
  }
  return bytes;
}

describe("Type-0 ghost placement", () => {
  it("derives body-relative sprite offsets from the first composite pose", () => {
    expect(ghostPlacement(ghost(), 64, 32, 32)).toEqual({ eyeX: -3, eyeY: 13, mouthX: 2, mouthY: 19, bodyOnly: false });
  });
  it("uses the body alone when the first two sprite slots are identical", () => {
    const bytes = ghost();
    const view = new DataView(bytes.buffer);
    view.setUint32(0x110, 0x1000, true);
    view.setUint32(0x114, 2, true);
    view.setUint32(0x118, 0x1100, true);
    view.setUint32(0x11c, 2, true);
    bytes.set([1, 2], 0x1000);
    bytes.set([1, 2], 0x1100);
    expect(ghostPlacement(bytes, 64, 32, 32)?.bodyOnly).toBe(true);
  });
  it("rejects erased geometry", () => {
    const bytes = ghost();
    bytes.fill(0xff, 0x670, 0x670 + 3 * 22);
    expect(ghostPlacement(bytes, 64, 32, 32)).toBeNull();
  });
});
