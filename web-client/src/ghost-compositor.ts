// TRUE bin rendering: draw the pixels the Paradise actually emitted.
//
// Takes the raw ghost-payload bytes (first 0x20000 of a playdate packet),
// extracts the body/eyes/mouth sprite packages via tama-protocol's
// renderGhost(), and layers them onto a single HTMLCanvasElement. No
// pre-rendered PNGs, no charaId → filename lookup; whatever sprite pixels
// came over the wire is what we paint.

import { getCharacter, getCharacterByName, renderGhost, GhostRender, GhostSpritePart, RgbaImage } from "@tama-breed-poc/tama-protocol";
import { GhostPreview } from "./ghost-preview";

// Pick the character ID that drives positioning. For jade / lab ghosts the
// bin's charaId is the template (4017 = BBMarutchi); the real identity is in
// eyeCharaId. For BRED ghosts, the name encodes the BODY character while
// eyeCharaId is the EYE character - use body for positioning.
function positionCharaId(rendered: GhostRender): number {
  if (rendered.charaId === 4017) {
    // Template ghost - check if BRED (name's character differs from eyeCharaId)
    const bodyFromName = getCharacterByName(rendered.name);
    if (bodyFromName && bodyFromName.id !== rendered.eyeCharaId) {
      // BRED ghost - use body character (from name) for positioning
      return bodyFromName.id;
    }
    // JADE ghost - body and eyes are same character
    return rendered.eyeCharaId;
  }
  return rendered.charaId;
}

export interface CompositedGhost {
  bitmap: HTMLCanvasElement;
  name: string;
  details: string;
}

export function composeGhostPreviewFromBin(
  source: GhostPreview["source"],
  rawGhost: Uint8Array
): CompositedGhost | undefined {
  let rendered: GhostRender;
  try {
    rendered = renderGhost(rawGhost);
  } catch (error) {
    console.warn(`[compositor] renderGhost threw`, error);
    return undefined;
  }

  const parts = [rendered.body, rendered.eyes, rendered.mouth].filter(
    (p): p is GhostSpritePart => p !== undefined
  );
  if (parts.length === 0) {
    console.warn(
      `[compositor] no renderable sprites in bin (chara=${rendered.charaId}, eye=${rendered.eyeCharaId})`
    );
    return undefined;
  }

  // Eyes and mouth are positioned using the per-character metadata table
  // (CharacterDataEmbedded.cs) — authoritative source for Paradise sprite
  // compositing. Matches GhostPreviewCompositor.cs:98-103: sprite-header
  // offsets are intentionally NOT added on top (doing so double-counts the
  // shift for characters whose eye sprite carries its own offset, e.g.
  // Shigemi-san, producing visible eye drift).
  const positionId = positionCharaId(rendered);
  const character = getCharacter(positionId);
  if (!character) {
    console.warn(
      `[compositor] no positioning data for id=${positionId} (chara=${rendered.charaId}, eye=${rendered.eyeCharaId})`
    );
  }

  const base = rendered.body?.frame ?? parts[0]!.frame;
  const eyeX = character?.eyeX ?? 0;
  const eyeY = character?.eyeY ?? 0;
  const mouthX = character?.mouthX ?? 0;
  const mouthY = character?.mouthY ?? 0;

  // Grow the canvas to fit negative offsets (some characters have eye/mouth
  // shifted left/up of the body origin; TamaParadise does the same shift).
  const drawOffsetX = Math.max(0, -eyeX, -mouthX);
  const drawOffsetY = Math.max(0, -eyeY, -mouthY);
  const canvasWidth = Math.max(
    base.width + drawOffsetX,
    (rendered.eyes?.frame.width ?? 0) + drawOffsetX + eyeX,
    (rendered.mouth?.frame.width ?? 0) + drawOffsetX + mouthX
  );
  const canvasHeight = Math.max(
    base.height + drawOffsetY,
    (rendered.eyes?.frame.height ?? 0) + drawOffsetY + eyeY,
    (rendered.mouth?.frame.height ?? 0) + drawOffsetY + mouthY
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, canvasWidth);
  canvas.height = Math.max(1, canvasHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.imageSmoothingEnabled = false;

  if (rendered.body) drawRgba(ctx, rendered.body.frame, drawOffsetX, drawOffsetY);
  if (rendered.eyes) drawRgba(ctx, rendered.eyes.frame, drawOffsetX + eyeX, drawOffsetY + eyeY);
  if (rendered.mouth) drawRgba(ctx, rendered.mouth.frame, drawOffsetX + mouthX, drawOffsetY + mouthY);

  // English only on the canvas (fits in the plate). Japanese is still parsed
  // from the bin via ghost-name.ts and available in the GhostRender object.
  const displayName = rendered.name || `chara ${rendered.charaId}`;

  return {
    bitmap: canvas,
    name: displayName,
    details: `${source === "local" ? "your ghost" : "peer ghost"} · ${displayName} · stage ${rendered.stage}`
  };
}

function drawRgba(ctx: CanvasRenderingContext2D, image: RgbaImage, dx: number, dy: number): void {
  // Copy into a fresh Uint8ClampedArray<ArrayBuffer> because the DOM
  // ImageData typing is invariant over ArrayBuffer vs ArrayBufferLike.
  const buf = new Uint8ClampedArray(image.pixels.length);
  buf.set(image.pixels);
  const imageData = new ImageData(buf, image.width, image.height);
  // Layer by blitting to a temp canvas and drawImage-ing so transparency composes
  // correctly with whatever is underneath (putImageData overwrites pixels).
  const tmp = document.createElement("canvas");
  tmp.width = image.width;
  tmp.height = image.height;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.putImageData(imageData, 0, 0);
  // Shift so the sprite origin lands at (dx, dy). Many Paradise sprites use
  // offsets relative to a body-tile top-left; negative offsets are valid.
  ctx.drawImage(tmp, dx, dy);
}
