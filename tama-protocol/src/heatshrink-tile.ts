// SHS2 8/4 tile decoder, ported from TamaSuite.Firmware.Core/HeatshrinkTileCodec.cs.
// The firmware hook recognizes this envelope BEFORE XOR. See test/fixtures/
// heatshrink-relay.md for native UART evidence and scope.
const MAGIC = new TextEncoder().encode("SHS2TST!");
const HEADER_LENGTH = 12;
const MAX_TILE_LENGTH = 16384;

export function hasHeatshrinkMarker(data: Uint8Array): boolean {
  return data.length >= MAGIC.length && MAGIC.every((value, i) => data[i] === value);
}

export function decodeHeatshrinkTile(tile: Uint8Array, capacity: number): Uint8Array {
  if (!hasHeatshrinkMarker(tile) || tile.length < HEADER_LENGTH)
    throw new Error("Invalid Heatshrink tile header");
  const view = new DataView(tile.buffer, tile.byteOffset, tile.byteLength);
  const compressedLength = view.getUint16(8, true);
  const outputLength = view.getUint16(10, true);
  if (capacity <= 0 || capacity > MAX_TILE_LENGTH || outputLength <= 0 || outputLength > capacity)
    throw new Error("Heatshrink output exceeds tile dimensions");
  const end = HEADER_LENGTH + compressedLength;
  if (!compressedLength || tile.length > MAX_TILE_LENGTH || end > tile.length || tile.length - end > 3)
    throw new Error("Invalid Heatshrink input length");
  if (tile.subarray(end).some(value => value !== 0))
    throw new Error("Nonzero Heatshrink alignment padding");
  const encoded = tile.subarray(HEADER_LENGTH, end);
  let bitPosition = 0;
  const readBits = (count: number): number => {
    if (count > encoded.length * 8 - bitPosition)
      throw new Error("Truncated Heatshrink bitstream");
    let value = 0;
    for (let i = 0; i < count; i++, bitPosition++)
      value = (value << 1) | ((encoded[bitPosition >> 3]! >> (7 - (bitPosition & 7))) & 1);
    return value;
  };
  const output = new Uint8Array(outputLength);
  let produced = 0;
  while (produced < output.length) {
    if (readBits(1)) {
      output[produced++] = readBits(8);
    } else {
      const distance = readBits(8) + 1;
      const count = readBits(4) + 1;
      if (count > output.length - produced)
        throw new Error("Heatshrink backreference exceeds output");
      for (let i = 0; i < count; i++, produced++)
        output[produced] = distance > produced ? 0 : output[produced - distance]!;
    }
  }
  const remaining = encoded.length * 8 - bitPosition;
  if (remaining > 7 || readBits(remaining) !== 0)
    throw new Error("Trailing Heatshrink data or nonzero bit padding");
  return output;
}
