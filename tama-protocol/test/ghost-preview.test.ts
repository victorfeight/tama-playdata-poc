import { describe, expect, it } from "vitest";
import { calculateGhostChecksum } from "../src/ghost";
import { renderGhost } from "../src/ghost-render";
import { layoutGhostPreview } from "../src/ghost-placement";

// Authored indexed art avoids the legacy external BIN symlink. The original
// packet remains unchanged by previewing; slot/header/pose are distinct layers.
function authoredPacket(): Uint8Array {
  const packet = new Uint8Array(0x20000);
  const view = new DataView(packet.buffer);
  packet[16] = 0xff;
  let cursor = 0x1d34;
  for (let slot = 0; slot < 3; slot++) {
    const height = slot === 0 ? 64 : 32;
    const length = 56 + 64 * height / 2;
    view.setUint32(0x110 + slot * 8,cursor,true);
    view.setUint32(0x114 + slot * 8,length,true);
    view.setUint32(cursor,length,true);
    packet[cursor+4] = 4; // transparent index0
    packet[cursor+5] = 2; // 4bpp
    view.setUint16(cursor+6,1,true);
    packet[cursor+8] = 64;
    packet[cursor+9] = height;
    view.setInt8(cursor+10,slot === 1 ? -3 : slot === 2 ? 2 : 0);
    view.setInt8(cursor+11,slot === 1 ? -2 : slot === 2 ? 1 : 0);
    packet[cursor+12] = 1;
    packet[cursor+13] = 1;
    packet[cursor+15] = 1;
    view.setUint16(cursor+18,24,true);
    view.setUint16(cursor+20,56,true);
    view.setUint16(cursor+26,0xf800,true);
    packet.fill(0x11,cursor+56,cursor+length);
    const pose = 0x66e + slot * 22;
    view.setUint16(pose,slot,true);
    view.setInt16(pose+4,slot === 0 ? -32 : slot === 1 ? -24 : -16,true);
    view.setUint16(pose+6,4096,true);
    view.setUint16(pose+10,64,true);
    cursor += length;
  }
  view.setUint16(0x142,0xf800,true);
  view.setUint16(0x162,0xf800,true);
  view.setUint32(0x10c,cursor,true);
  const checksum = calculateGhostChecksum(packet);
  view.setUint32(0,checksum.checksum,true);
  view.setUint32(4,checksum.complement,true);
  return packet;
}

describe("BIN to online preview", () => {
  it("keeps signed sprite origins through decoding and places face parts once", () => {
    const packet = authoredPacket();
    const before = packet.slice();
    const rendered = renderGhost(packet);
    expect(rendered.validChecksum).toBe(true);
    expect(rendered.eyes?.frame.pixels.slice(0,4)).toEqual(new Uint8ClampedArray([255,0,0,255]));
    const layout = layoutGhostPreview(packet,rendered)!;
    expect(layout.layers.map(l => [l.part,l.x,l.y])).toEqual([
      ["body",3,0],["eyes",0,22],["mouth",5,33],
    ]);
    expect(packet).toEqual(before);
  });

  it("keeps embedded genetic art but omits it when the pose hides the face", () => {
    const packet = authoredPacket();
    packet.fill(0,0x66e+22,0x66e+66);
    const rendered = renderGhost(packet);
    expect(rendered.eyes).toBeDefined();
    expect(rendered.mouth).toBeDefined();
    const layout = layoutGhostPreview(packet,rendered)!;
    expect(layout.layers.map(l => l.part)).toEqual(["body"]);
    expect([layout.width,layout.height]).toEqual([64,64]);
  });
});
