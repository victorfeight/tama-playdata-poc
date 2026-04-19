export const GHOST_SIZE = 0x20000;
export const GHOST_HEADER_USED_LENGTH = 0x180;
export const GHOST_COMPOSITES_OFFSET = 0x600;
export const GHOST_COMPOSITES_END = 0x1d34;

export interface SpriteEntry {
  offset: number;
  length: number;
}

export interface GhostHeader {
  checksum: number;
  checksumComplement: number;
  flags: number;
  ghostType: number;
  charaId: number;
  eyeCharaId: number;
  color: number;
  stage: number;
  speciesRank: number;
  charaFlags: CharaFlags;
  totalLength: number;
  spriteLocations: SpriteEntry[][];
  bodyPalette: number[];
  mouthPalette: number[];
}

// chara_flags_t at offset 0x100 in ghost_data_t (per ghost spec §Ghost data).
// Stored as a u32 but only the low 3 bits are meaningful; keep raw for future
// bits, expose the known booleans as decoded shorthand.
export interface CharaFlags {
  raw: number;
  isConsumer: boolean;    // bit 0 — may eat other tamas in playdate
  isConsumee: boolean;    // bit 1 — may be eaten in playdate
  isUnbreedable: boolean; // bit 2 — cannot be bred with (only BBMarutchi)
}

export function parseCharaFlags(raw: number): CharaFlags {
  return {
    raw,
    isConsumer: (raw & 0x1) !== 0,
    isConsumee: (raw & 0x2) !== 0,
    isUnbreedable: (raw & 0x4) !== 0
  };
}

export interface ParsedGhost extends GhostHeader {
  validChecksum: boolean;
  calculatedChecksum: number;
  calculatedComplement: number;
  actualCharaId: number;
  isBred: boolean;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function spriteTableOffsetForType(ghostType: number): number {
  return ghostType === 0 ? 0x110 : 0x108;
}

export function parseGhost(data: Uint8Array): ParsedGhost {
  if (data.length < GHOST_HEADER_USED_LENGTH) {
    throw new Error(`ghost data too short: ${data.length}`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = u32(view, 0x08);
  const ghostType = flags & 0x03;
  const spriteTableOffset = spriteTableOffsetForType(ghostType);

  const spriteLocations: SpriteEntry[][] = [];
  for (let zoom = 0; zoom < 2; zoom += 1) {
    const group: SpriteEntry[] = [];
    for (let part = 0; part < 3; part += 1) {
      const offset = spriteTableOffset + (zoom * 3 + part) * 8;
      group.push({
        offset: u32(view, offset),
        length: u32(view, offset + 4)
      });
    }
    spriteLocations.push(group);
  }

  const bodyPalette = readPalette(view, 0x140);
  const mouthPalette = readPalette(view, 0x160);
  const charaId = u16(view, 0x0c);
  const eyeCharaId = u16(view, 0x0e);
  const color = view.getUint8(0x10);
  const { checksum, complement } = calculateGhostChecksum(data);

  return {
    checksum: u32(view, 0x00),
    checksumComplement: u32(view, 0x04),
    flags,
    ghostType,
    charaId,
    eyeCharaId,
    color,
    stage: u16(view, 0xfc),
    speciesRank: u16(view, 0xfe),
    charaFlags: parseCharaFlags(u32(view, 0x100)),
    totalLength: u32(view, 0x10c),
    spriteLocations,
    bodyPalette,
    mouthPalette,
    validChecksum: u32(view, 0x00) === checksum && u32(view, 0x04) === complement,
    calculatedChecksum: checksum,
    calculatedComplement: complement,
    actualCharaId: charaId !== eyeCharaId ? eyeCharaId : charaId,
    isBred: charaId !== eyeCharaId || color !== 0xff
  };
}

function readPalette(view: DataView, offset: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < 16; i += 1) values.push(u16(view, offset + i * 2));
  return values;
}

export function calculateGhostChecksum(input: Uint8Array): { checksum: number; complement: number } {
  if (input.length > GHOST_SIZE) {
    throw new Error(`ghost data too large: ${input.length}`);
  }

  const data = new Uint8Array(GHOST_SIZE);
  data.fill(0xff);
  data.set(input.slice(0, GHOST_SIZE), 0);
  data[0] = 0;
  data[1] = 0;
  data[2] = 0;
  data[3] = 0;
  data[4] = 0;
  data[5] = 0;
  data[6] = 0;
  data[7] = 0;

  const view = new DataView(data.buffer);
  const ghostType = view.getUint32(0x08, true) & 0x03;
  const spriteTableOffset = spriteTableOffsetForType(ghostType);
  let checksum = 0;

  for (let offset = 0; offset < GHOST_HEADER_USED_LENGTH; offset += 4) {
    checksum = (checksum + view.getUint32(offset, true)) >>> 0;
  }

  for (let offset = GHOST_COMPOSITES_OFFSET; offset < GHOST_COMPOSITES_END; offset += 4) {
    checksum = (checksum + view.getUint32(offset, true)) >>> 0;
  }

  for (let i = 0; i < 6; i += 1) {
    const spriteOffset = view.getUint32(spriteTableOffset + i * 8, true);
    const length = view.getUint32(spriteTableOffset + i * 8 + 4, true);
    if (spriteOffset === 0 || spriteOffset >= data.length || length === 0) continue;

    const end = Math.min(spriteOffset + length, data.length);
    for (let offset = spriteOffset; offset < end - 3; offset += 4) {
      checksum = (checksum + view.getUint32(offset, true)) >>> 0;
    }
  }

  return { checksum, complement: (-checksum) >>> 0 };
}
