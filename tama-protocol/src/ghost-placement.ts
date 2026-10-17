/** Placement encoded in a Type-0 ghost's first close-up composite pose.
 * Matches TamaHome's GhostEditorService.DeriveOffsetsFromComposite. */
import type { RgbaImage } from "./sprite-parser";
export interface GhostPlacement {
  eyeX: number;
  eyeY: number;
  mouthX: number;
  mouthY: number;
  bodyOnly: boolean;
}

const POSE = 0x600 + 0x70; // state 1, block 0 X; state 0 is blank
const BLOCK = 22;

function activePart(ghost: Uint8Array, part: number): boolean {
  // POSE points to X, two bytes after the block's sprite selector. Empty
  // zero/erased blocks do not draw their separately stored genetic artwork.
  const start = POSE - 2 + part * BLOCK;
  return ghost.subarray(start, start + BLOCK).some(byte => byte !== 0 && byte !== 0xff);
}

function precomposed(ghost: Uint8Array): boolean {
  if (ghost.length < 0x120) return false;
  const view = new DataView(ghost.buffer, ghost.byteOffset, ghost.byteLength);
  const a = view.getUint32(0x110, true);
  const n = view.getUint32(0x114, true);
  const b = view.getUint32(0x118, true);
  if (!a || !b || !n || n !== view.getUint32(0x11c, true) || a + n > ghost.length || b + n > ghost.length) return false;
  for (let i = 0; i < n; i++) if (ghost[a + i] !== ghost[b + i]) return false;
  return true;
}

export function ghostPlacement(ghost: Uint8Array, bodyHeight: number, eyeHeight: number, mouthHeight: number): GhostPlacement | null {
  if (ghost.length < POSE + 3 * BLOCK || (ghost[8]! & 3) !== 0) return null;
  if (precomposed(ghost)) return { eyeX: 0, eyeY: 0, mouthX: 0, mouthY: 0, bodyOnly: true };
  if (!activePart(ghost, 0)) return null;
  const view = new DataView(ghost.buffer, ghost.byteOffset, ghost.byteLength);
  const point = (part: number) => ({
    x: view.getInt16(POSE + part * BLOCK, true),
    y: view.getInt16(POSE + part * BLOCK + 2, true),
  });
  const body = point(0);
  const eye = point(1);
  const mouth = point(2);
  return {
    eyeX: eye.x - body.x,
    eyeY: eye.y - body.y + Math.trunc((bodyHeight - eyeHeight) / 2),
    mouthX: mouth.x - body.x,
    mouthY: mouth.y - body.y + Math.trunc((bodyHeight - mouthHeight) / 2),
    bodyOnly: !activePart(ghost, 1) && !activePart(ghost, 2),
  };
}

interface PreviewPart {
  frame: RgbaImage;
  offsetX: number;
  offsetY: number;
}

export interface GhostPreviewLayout {
  width: number;
  height: number;
  layers: { part: "body" | "eyes" | "mouth"; image: RgbaImage; x: number; y: number }[];
}

/** Compose geometry once for every preview surface. Image-header origins are
 * independent of composite coordinates and must each be applied exactly once.
 * No character-ID/edition lookup: the received packet carries its own geometry.
 */
export function layoutGhostPreview(
  ghost: Uint8Array,
  parts: { body?: PreviewPart | undefined; eyes?: PreviewPart | undefined; mouth?: PreviewPart | undefined }
): GhostPreviewLayout | null {
  if (!parts.body) return null;
  const placement = ghostPlacement(ghost, parts.body.frame.height, parts.eyes?.frame.height ?? 0, parts.mouth?.frame.height ?? 0);
  if (!placement) return null;
  const layers: GhostPreviewLayout["layers"] = [{ part: "body", image: parts.body.frame,
    x: parts.body.offsetX, y: parts.body.offsetY }];
  for (const [part, index, x, y] of [
    ["eyes", 1, placement.eyeX, placement.eyeY],
    ["mouth", 2, placement.mouthX, placement.mouthY],
  ] as const) {
    const sprite = parts[part];
    if (!placement.bodyOnly && sprite && activePart(ghost, index)) {
      layers.push({ part, image: sprite.frame, x: x + sprite.offsetX, y: y + sprite.offsetY });
    }
  }
  const left = Math.min(0, ...layers.map(layer => layer.x));
  const top = Math.min(0, ...layers.map(layer => layer.y));
  const width = Math.max(...layers.map(layer => layer.x + layer.image.width)) - left;
  const height = Math.max(...layers.map(layer => layer.y + layer.image.height)) - top;
  return { width, height, layers: layers.map(layer => ({ ...layer, x: layer.x - left, y: layer.y - top })) };
}
