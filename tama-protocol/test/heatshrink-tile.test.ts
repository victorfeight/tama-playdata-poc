import { describe, expect, it } from "vitest";
import { decodeHeatshrinkTile } from "../src/heatshrink-tile";
import { parseSingleSpriteImage } from "../src/sprite-parser";

// Explicit wire vectors: MSB-first literal tags and 8/4 backreferences.
function envelope(bits: string, outputLength: number): Uint8Array {
  const result = new Uint8Array(12 + Math.ceil(bits.length / 8));
  result.set(new TextEncoder().encode("SHS2TST!"));
  const view = new DataView(result.buffer);
  view.setUint16(8, result.length - 12, true);
  view.setUint16(10, outputLength, true);
  for (let i = 0; i < bits.length; i++) result[12 + (i >> 3)]! |= Number(bits[i]) << (7 - (i & 7));
  return result;
}
const hs = envelope("1" + "00010000" + "1" + "00110010" + "0" + "00000001" + "0001", 4);
const rle = Uint8Array.of(0x84, 0x10, 0x32, 0x10, 0x32);
const xor = (bytes: Uint8Array) => bytes.map(value => value ^ 0x53);

function sprite(tiles: Uint8Array[], encrypted = false, compression = 0x20): Uint8Array {
  const pixels = 56;
  const result = new Uint8Array(pixels + tiles.length * 8 + tiles.reduce((n, tile) => n + tile.length, 0));
  const view = new DataView(result.buffer);
  view.setUint32(0, result.length, true);
  result[4] = compression | (encrypted ? 0x80 : 0);
  result[5] = 2; // 4 bpp
  view.setUint16(6, tiles.length, true);
  result[8] = 4; result[9] = 2; result[12] = 1; result[13] = 1; result[15] = 1;
  view.setUint16(18, 24, true); view.setUint16(20, pixels, true);
  for (let i = 0; i < 16; i++) view.setUint16(24 + i * 2, i * 0x111, true);
  let at = tiles.length * 8;
  tiles.forEach((tile, i) => {
    view.setUint32(pixels + i * 8, at, true);
    view.setUint32(pixels + i * 8 + 4, tile.length, true);
    result.set(tile, pixels + at); at += tile.length;
  });
  return result;
}

describe("SHS2 received ghost tiles", () => {
  it("decodes literal and overlapping/zero-window backreferences", () => {
    expect([...decodeHeatshrinkTile(hs, 4)]).toEqual([0x10, 0x32, 0x10, 0x32]);
    expect([...decodeHeatshrinkTile(envelope("0" + "11111111" + "1111", 16), 16)]).toEqual(Array(16).fill(0));
    expect([...decodeHeatshrinkTile(envelope("1" + "01000001" + "0" + "00000000" + "0010", 4), 4)]).toEqual([65,65,65,65]);
  });
  it.each([false, true])("renders mixed native and SHS2 tiles with encrypted=%s", encrypted => {
    const stock = parseSingleSpriteImage(sprite([rle, rle]));
    const mixed = parseSingleSpriteImage(sprite([hs, encrypted ? xor(rle) : rle], encrypted));
    expect(mixed.spritesheets).toEqual(stock.spritesheets);
    expect(mixed.firstFrame).toEqual(stock.firstFrame);
  });
  it("does not mistake an encrypted native plaintext marker for SHS2", () => {
    const native = new TextEncoder().encode("SHS2TST!");
    const decoded = parseSingleSpriteImage(sprite([xor(native)], true));
    // Native RLE's first pair repeats 0x48 83 times; only four bytes fit this tile.
    const expected = parseSingleSpriteImage(sprite([Uint8Array.of(4, 72)]));
    expect(decoded.firstFrame).toEqual(expected.firstFrame);
    expect(decoded.firstFrame?.pixels.some(value => value !== 0)).toBe(true);
  });
  it("retains native wordwise decoding", () => {
    const words = Uint8Array.of(1,0,0,128,0x10,0x32,0x10,0x32);
    expect(parseSingleSpriteImage(sprite([words], false, 0x40)).firstFrame)
      .toEqual(parseSingleSpriteImage(sprite([rle])).firstFrame);
  });
  it("rejects malformed lengths, truncation, overflow and padding", () => {
    expect(() => decodeHeatshrinkTile(hs, 3)).toThrow();
    expect(() => decodeHeatshrinkTile(hs.slice(0, -1), 4)).toThrow();
    expect(() => decodeHeatshrinkTile(envelope("0" + "00000000" + "1111", 4), 4)).toThrow();
    const badBits = hs.slice(); badBits[badBits.length - 1]! |= 1;
    expect(() => decodeHeatshrinkTile(badBits, 4)).toThrow();
    expect(() => decodeHeatshrinkTile(Uint8Array.of(...hs, 1), 4)).toThrow();
    expect(() => decodeHeatshrinkTile(envelope("", 4), 4)).toThrow();
  });
});
