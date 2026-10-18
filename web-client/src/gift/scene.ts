import { getItemCatalogEntry, ItemCatalogEntry } from "./item-catalog";
import { Drawer } from "../ui/drawer";
import { Object2d } from "../ui/object2d";

type Side = "local" | "peer";

interface SlotState {
  itemId?: number;
  entry?: ItemCatalogEntry;
  image?: HTMLImageElement;
  seenAt?: number;
}

const SLOT: Record<Side, { x: number; y: number; w: number; h: number; labelY: number }> = {
  local: { x: 190, y: 204, w: 160, h: 132, labelY: 354 },
  peer: { x: 450, y: 204, w: 160, h: 132, labelY: 354 }
};


export class Scene {
  private status = "waiting for gifts";
  private readonly slots: Record<Side, SlotState> = { local: {}, peer: {} };

  constructor(private readonly drawer: Drawer) {}

  mount(): void {
    this.drawer.clear();
    this.drawer.add(new Object2d({ x: 0, y: 0, width: 0, height: 0, opacity: 0, z: 2, onDraw: (_object, ctx) => this.drawOverlay(ctx) }));
    this.drawer.start();
  }

  setStatus(status: string): void {
    this.status = status;
  }

  setItem(side: Side, itemId: number): void {
    if (this.slots[side].itemId === itemId) return; // Retries are not new gifts.
    const entry = getItemCatalogEntry(itemId);
    const state: SlotState = { itemId, seenAt: performance.now() };
    if (entry) state.entry = entry;
    if (entry) {
      const image = new Image();
      image.onload = () => { state.image = image; };
      image.src = `/sprites/items/${entry.sprite}`;
    }
    this.slots[side] = state;
  }

  beginSession(): void {
    this.slots.local = {}; this.slots.peer = {}; this.status = "waiting for gifts";
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.save(); ctx.imageSmoothingEnabled = false;
    this.drawSlot(ctx, "local"); this.drawSlot(ctx, "peer");
    this.drawStatus(ctx); ctx.restore();
  }

  private drawSlot(ctx: CanvasRenderingContext2D, side: Side): void {
    const slot = SLOT[side];
    const state = this.slots[side];
    const centerX = slot.x + slot.w / 2;
    const centerY = slot.y + slot.h / 2;

    if (state.image?.complete && state.image.naturalWidth > 0) {
      const age = performance.now() - (state.seenAt ?? 0);
      const pop = age < 520 ? easeOutBack(Math.min(1, age / 520)) : 1;
      const scale = 2.4 * pop;
      const { w, h } = fitItemSize(state.image, scale);
      ctx.drawImage(state.image, centerX - w / 2, centerY - h / 2 + 8, w, h);
    } else if (state.itemId !== undefined) {
      ctx.font = "24px Pixelify, sans-serif";
      ctx.fillStyle = "#24342d";
      ctx.textAlign = "center";
      ctx.fillText("unknown", centerX, centerY + 16);
    } else {
      ctx.font = "18px Pixelify, sans-serif";
      ctx.fillStyle = "rgba(36, 52, 45, 0.58)";
      ctx.textAlign = "center";
      ctx.fillText("waiting", centerX, centerY + 6);
    }

    ctx.font = "18px Pixelify, sans-serif";
    ctx.fillStyle = "#24342d";
    ctx.textAlign = "center";
    const name = state.entry?.name ?? (state.itemId === undefined ? (side === "local" ? "your offer" : "their offer") : "unknown item");
    drawCenteredText(ctx, name, centerX, slot.labelY, 170);
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    drawPlate(ctx, 238, 410, 324, 46);
    ctx.font = "20px Pixelify, sans-serif";
    ctx.fillStyle = "#24342d";
    ctx.textAlign = "center";
    drawCenteredText(ctx, this.status, 400, 440, 286);
  }
}

function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  ctx.fillStyle = "rgba(255, 253, 247, 0.9)";
  ctx.strokeStyle = "#24342d";
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, width, height, 7);
  ctx.fill();
  ctx.stroke();
}

function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  const words = text.split(" ");
  let line = "";
  let lineY = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += 18;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}

// Preserve the source PNG's aspect ratio. Clamp the longer side to 92px
// (post-scale) so wide or tall items never bust out of the slot.
function fitItemSize(image: HTMLImageElement, scale: number): { w: number; h: number } {
  const nw = image.naturalWidth;
  const nh = image.naturalHeight;
  const longest = Math.max(nw, nh) * scale;
  const cap = Math.min(92, longest);
  const ratio = cap / Math.max(nw, nh);
  return { w: nw * ratio, h: nh * ratio };
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
