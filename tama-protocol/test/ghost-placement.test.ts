import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ghostPlacement, layoutGhostPreview } from "../src/ghost-placement";

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

function part(width: number, height: number, offsetX = 0, offsetY = 0) {
  return { frame: { width, height, pixels: new Uint8ClampedArray(width * height * 4) }, offsetX, offsetY };
}

describe("packet preview layout", () => {
  it("applies body, eye and mouth header origins once, independently of pose positions", () => {
    const result = layoutGhostPreview(ghost(), {
      body: part(64, 64, 3, -2), eyes: part(64, 32, -4, 5), mouth: part(64, 32, 2, -1),
    });
    expect(result?.layers.map(({ part, x, y }) => ({ part, x, y }))).toEqual([
      { part: "body", x: 10, y: 0 }, { part: "eyes", x: 0, y: 20 }, { part: "mouth", x: 11, y: 20 },
    ]);
    expect([result?.width, result?.height]).toEqual([75, 64]);
  });

  it("retains custom eye/mouth nudges alongside native image origins", () => {
    const bytes = ghost();
    const view = new DataView(bytes.buffer);
    view.setInt16(0x670 + 22, -5, true);
    view.setInt16(0x670 + 44 + 2, 19, true);
    const result = layoutGhostPreview(bytes, { body: part(64,64), eyes: part(64,32,2,-2), mouth: part(64,32,-1,3) });
    const [body, eyes, mouth] = result!.layers;
    expect([eyes!.x - body!.x, eyes!.y - body!.y]).toEqual([-15, 11]);
    expect([mouth!.x - body!.x, mouth!.y - body!.y]).toEqual([1, 18]);
  });

  it("does not draw or reserve canvas space for hidden genetic eyes/mouth", () => {
    const bytes = ghost();
    bytes.fill(0, 0x66e + 22, 0x66e + 5 * 22);
    // A complete custom body and distinct, stored genetic eye art are not
    // duplicate packages. Visibility comes from the selected native pose.
    const result = layoutGhostPreview(bytes, { body: part(128,128), eyes: part(64,32,-100,-100), mouth: part(64,32) });
    expect(result?.layers.map(layer => layer.part)).toEqual(["body"]);
    expect([result?.width, result?.height]).toEqual([128,128]);
  });

  it("can hide mouth without hiding eyes and refuses absent body geometry", () => {
    const bytes = ghost();
    bytes.fill(0xff, 0x66e + 44, 0x66e + 66);
    const parts = { body: part(64,64), eyes: part(64,32), mouth: part(64,32) };
    expect(layoutGhostPreview(bytes, parts)?.layers.map(layer => layer.part)).toEqual(["body","eyes"]);
    bytes.fill(0, 0x66e, 0x66e + 22);
    expect(layoutGhostPreview(bytes, parts)).toBeNull();
  });
});

const nativeGeometry = JSON.parse(readFileSync(new URL("./fixtures/ghost-preview-geometry.json", import.meta.url), "utf8")) as {
  cases: { label: string; flags: number; poseHex: string;
    parts: Record<string, { width: number; height: number; offsetX: number; offsetY: number }> }[];
};
const expectedFaceY: Record<string, [number, number]> = {
  Land: [24,32], Water: [24,32], Sky: [24,32], Jade: [19,22], Tropical: [24,32], Glacier: [27,28],
  // Native packet eye anchor would give22, but its own signed image origin
  // moves it up2. This is the real stock regression missed by the old canvas.
  papillotchi: [20,23],
};

describe("retained native/corpus geometry", () => {
  for (const sample of nativeGeometry.cases) {
    it(sample.label, () => {
      const bytes = new Uint8Array(0x2000);
      bytes[8] = sample.flags;
      bytes.set(Buffer.from(sample.poseHex,"hex"),0x66e);
      const parts = Object.fromEntries(Object.entries(sample.parts).map(([name,p]) =>
        [name,part(p.width,p.height,p.offsetX,p.offsetY)]));
      const result = layoutGhostPreview(bytes,parts);
      expect(result).not.toBeNull();
      if (sample.label === "Metafoamtchi") {
        expect(result?.layers.map(l => l.part)).toEqual(["body"]);
        expect([result?.width,result?.height]).toEqual([128,128]);
      } else {
        expect(result?.layers.map(l => [l.x,l.y])).toEqual([[0,0],[0,expectedFaceY[sample.label]![0]],[0,expectedFaceY[sample.label]![1]]]);
        expect([result?.width,result?.height]).toEqual([64,64]);
      }
    });
  }
});
