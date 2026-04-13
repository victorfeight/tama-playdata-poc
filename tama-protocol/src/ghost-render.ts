// High-level renderer: takes a Paradise ghost bin (type 0, the only variant used
// during playdate transfers) and returns the rendered body/eyes/mouth sprites
// plus the name read from the bin.
//
// Layout (from ghost.ts):
//   spriteLocations[0] = tama-view  [body, eyes, mouth]
//   spriteLocations[1] = field-view [body, eyes, mouth]  (ignored here)
// Each entry is { offset, length } pointing into the ghost bin itself.

import { parseGhost } from "./ghost";
import { getEnglishGhostName, getJapaneseGhostName } from "./ghost-name";
import { parseSingleSpriteImage, rgb565PaletteToRgba, RgbaImage, SpriteHeader } from "./sprite-parser";

export interface GhostSpritePart {
  header: SpriteHeader;
  frame: RgbaImage; // first frame, palette 0
  // Canvas-space offset (signed, from the sprite header) to position this part
  // relative to the body origin. Eyes/mouth use these offsets on a real device.
  offsetX: number;
  offsetY: number;
}

export interface GhostRender {
  name: string;
  japaneseName: string;
  charaId: number;
  eyeCharaId: number;
  color: number;
  stage: number;
  charaFlags: import("./ghost").CharaFlags;
  validChecksum: boolean;
  body: GhostSpritePart | undefined;
  eyes: GhostSpritePart | undefined;
  mouth: GhostSpritePart | undefined;
}

/**
 * Render a ghost bin into its body/eyes/mouth parts + metadata.
 * Throws only on unrecoverable parse errors (truncated header). Individual
 * sprite extraction failures return undefined for that part rather than
 * aborting the whole render -- so a slightly-malformed eyes package does
 * not prevent the body from drawing.
 */
export function renderGhost(ghost: Uint8Array): GhostRender {
  const parsed = parseGhost(ghost);
  const tamaView = parsed.spriteLocations[0] ?? [];

  // Convert the ghost header's palettes to RGBA once. body_palette and
  // mouth_palette are the AUTHORITATIVE final palettes for this ghost
  // (post color selection); spec §Ghost data. Eyes intentionally pass no
  // override -- they always use the embedded sprite's own palette.
  const bodyPaletteRgba = parsed.bodyPalette.length ? rgb565PaletteToRgba(parsed.bodyPalette) : undefined;
  const mouthPaletteRgba = parsed.mouthPalette.length ? rgb565PaletteToRgba(parsed.mouthPalette) : undefined;

  const body = extractPart(ghost, tamaView[0], bodyPaletteRgba);
  const eyes = extractPart(ghost, tamaView[1], undefined);
  const mouth = extractPart(ghost, tamaView[2], mouthPaletteRgba);

  return {
    name: getEnglishGhostName(ghost),
    japaneseName: getJapaneseGhostName(ghost),
    charaId: parsed.charaId,
    eyeCharaId: parsed.eyeCharaId,
    color: parsed.color,
    stage: parsed.stage,
    charaFlags: parsed.charaFlags,
    validChecksum: parsed.validChecksum,
    body,
    eyes,
    mouth
  };
}

function extractPart(
  ghost: Uint8Array,
  entry: { offset: number; length: number } | undefined,
  overridePalette: Uint32Array | undefined
): GhostSpritePart | undefined {
  if (!entry) return undefined;
  if (entry.length === 0) return undefined;
  if (entry.offset <= 0 || entry.offset >= ghost.byteLength) return undefined;
  const end = Math.min(entry.offset + entry.length, ghost.byteLength);
  const packageBytes = ghost.subarray(entry.offset, end);

  let image;
  try {
    image = parseSingleSpriteImage(packageBytes, { overridePalette });
  } catch {
    return undefined;
  }
  if (!image.firstFrame) return undefined;
  return {
    header: image.header,
    frame: image.firstFrame,
    offsetX: image.header.offsetX,
    offsetY: image.header.offsetY
  };
}
