// TRUE bin rendering: draw the pixels the Paradise actually emitted.
//
// Takes the raw ghost-payload bytes (first 0x20000 of a playdate packet),
// extracts the body/eyes/mouth sprite packages via tama-protocol's
// renderGhost(), and layers them onto a single HTMLCanvasElement. No
// pre-rendered PNGs, no charaId → filename lookup; whatever sprite pixels
// came over the wire is what we paint.

import { ghostPlacement, renderGhost, GhostRender, GhostSpritePart, RgbaImage } from "@tama-breed-poc/tama-protocol";
import { GhostPreview } from "./ghost-preview";

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

  const base = rendered.body?.frame ?? parts[0]!.frame;
  const placement = ghostPlacement(rawGhost, base.height, rendered.eyes?.frame.height ?? 32, rendered.mouth?.frame.height ?? 32);
  if (!placement) {
    console.warn("[compositor] ghost has no usable Type-0 composite geometry");
    return undefined;
  }
  const { eyeX, eyeY, mouthX, mouthY } = placement;

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
  if (!placement.bodyOnly && rendered.eyes) drawRgba(ctx, rendered.eyes.frame, drawOffsetX + eyeX, drawOffsetY + eyeY);
  if (!placement.bodyOnly && rendered.mouth) drawRgba(ctx, rendered.mouth.frame, drawOffsetX + mouthX, drawOffsetY + mouthY);

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
