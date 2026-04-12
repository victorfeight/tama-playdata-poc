import { CHARACTER_BY_ID, colorNameFromIndex, mapLabCharacterId } from "./character-data";
import { GhostPreview } from "./ghost-preview";

export interface CompositedGhost {
  bitmap: HTMLCanvasElement;
  name: string;
  details: string;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export async function composeGhostPreview(ghost: GhostPreview): Promise<CompositedGhost | undefined> {
  const bodyId = resolveBodyId(ghost);
  const eyeId = mapLabCharacterId(ghost.eyeCharaId);
  const body = CHARACTER_BY_ID.get(bodyId);
  if (!body) return undefined;

  const [bodyImage, eyeImage, mouthImage] = await Promise.all([
    loadPart(bodyId, "body"),
    loadPart(eyeId, "eyes"),
    loadPart(bodyId, "mouth")
  ]);
  if (!bodyImage || !eyeImage || !mouthImage) return undefined;

  const drawOffsetX = Math.max(0, -body.eyeX, -body.mouthX);
  const drawOffsetY = Math.max(0, -body.eyeY, -body.mouthY);
  const canvasWidth = Math.max(
    bodyImage.naturalWidth + drawOffsetX,
    eyeImage.naturalWidth + drawOffsetX + body.eyeX,
    mouthImage.naturalWidth + drawOffsetX + body.mouthX
  );
  const canvasHeight = Math.max(
    bodyImage.naturalHeight + drawOffsetY,
    eyeImage.naturalHeight + drawOffsetY + body.eyeY,
    mouthImage.naturalHeight + drawOffsetY + body.mouthY
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, canvasWidth);
  canvas.height = Math.max(1, canvasHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bodyImage, drawOffsetX, drawOffsetY);
  ctx.drawImage(eyeImage, drawOffsetX + body.eyeX, drawOffsetY + body.eyeY);
  ctx.drawImage(mouthImage, drawOffsetX + body.mouthX, drawOffsetY + body.mouthY);

  return {
    bitmap: canvas,
    name: body.name,
    details: `${ghost.source === "local" ? "You" : "Peer"} / ${colorNameFromIndex(ghost.color)} / stage ${ghost.stage}`
  };
}

export function resolveBodyId(ghost: GhostPreview): number {
  const eyeId = mapLabCharacterId(ghost.eyeCharaId);
  const charaId = mapLabCharacterId(ghost.charaId);
  if (ghost.charaId === 4017 && eyeId !== 4017) return eyeId;
  return charaId;
}

async function loadPart(id: number, part: "body" | "eyes" | "mouth"): Promise<HTMLImageElement | undefined> {
  const src = `/sprites/characters/${id}_${part}.png`;
  try {
    return await loadImage(src);
  } catch {
    return undefined;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${src}`));
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}
