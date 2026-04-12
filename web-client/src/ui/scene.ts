import { Drawer } from "./drawer";
import { Object2d } from "./object2d";
import { CompositedGhost } from "../ghost-compositor";
import { GhostPreview } from "../ghost-preview";

const FRIENDSHIP_MAX = 4;
// 48x16 "horizontal half heart" strip frames in order: full, half, empty.
// We use only frame 0 (full) and frame 2 (empty); middle half is skipped
// because Paradise friendship is integer 0..4.
const HEART_SRC_FULL_X = 0;
const HEART_SRC_EMPTY_X = 32;
const HEART_SIZE = 16;

export class Scene {
  private localGhost?: Object2d;
  private peerGhost?: Object2d;
  private localLabel = "your tama";
  private peerLabel = "peer tama";
  private status = "native link ready";
  private friendship: number | undefined;
  private heartImage: HTMLImageElement | undefined;

  constructor(private readonly drawer: Drawer) {
    const img = new Image();
    img.onload = () => { this.heartImage = img; };
    img.src = "/sprites/heart.png";
  }

  mount(): void {
    this.drawer.clear();
    this.localGhost = this.drawer.add(new Object2d({
      img: "/sprites/ghost_01.png",
      x: 150,
      y: 218,
      width: 176,
      height: 176,
      z: 2,
      opacity: 0.48,
      onDraw: (object) => {
        object.y = 218 + Math.sin(performance.now() / 520) * 8;
      }
    }));
    this.peerGhost = this.drawer.add(new Object2d({
      img: "/sprites/ghost_01.png",
      x: 474,
      y: 218,
      width: 176,
      height: 176,
      z: 2,
      opacity: 0.48,
      flipX: true,
      onDraw: (object) => {
        object.y = 218 + Math.sin(performance.now() / 520 + Math.PI * 0.35) * 8;
      }
    }));
    this.drawer.add(new Object2d({ x: 0, y: 0, width: 0, height: 0, opacity: 0, z: 3, onDraw: (_object, ctx) => this.drawHud(ctx) }));
    this.drawer.start();
  }

  showGhost(source: GhostPreview["source"], rendered: CompositedGhost): void {
    const target = source === "local" ? this.localGhost : this.peerGhost;
    if (!target) return;
    target.canvas = rendered.bitmap;
    target.image = undefined;
    target.opacity = 1;
    target.width = 150;
    target.height = 150;
    target.x = source === "local" ? 172 : 486;
    target.y = 224;

    if (source === "local") this.localLabel = rendered.name;
    else this.peerLabel = rendered.name;
    // Do NOT overwrite status here -- it's reserved for playdate result
    // (fight/play/eat/breed). Ghost name is already shown in the top plates.
  }

  setStatus(status: string): void {
    this.status = status;
  }

  setFriendship(level: number): void {
    // Paradise caps friendship at 4. Clamp so a malformed packet can't make
    // us try to draw a weird number of hearts.
    this.friendship = Math.max(0, Math.min(FRIENDSHIP_MAX, Math.round(level)));
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.font = "22px Pixelify, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 253, 247, 0.88)";
    ctx.strokeStyle = "#1f2520";
    ctx.lineWidth = 3;
    drawPlate(ctx, 92, 52, 212, 54);
    drawPlate(ctx, 496, 52, 212, 54);
    drawPlate(ctx, 248, 424, 304, 46);
    ctx.fillStyle = "#1f2520";
    drawCenteredText(ctx, this.localLabel, 198, 86, 176);
    drawCenteredText(ctx, this.peerLabel, 602, 86, 176);
    ctx.font = "18px Pixelify, sans-serif";
    drawCenteredText(ctx, this.status, 400, 454, 256);
    this.drawFriendshipHearts(ctx);
    ctx.restore();
  }

  private drawFriendshipHearts(ctx: CanvasRenderingContext2D): void {
    if (this.friendship === undefined || !this.heartImage) return;
    const scale = 2; // render 16x16 hearts at 32px for readability
    const size = HEART_SIZE * scale;
    const gap = 4;
    const totalWidth = FRIENDSHIP_MAX * size + (FRIENDSHIP_MAX - 1) * gap;
    const startX = Math.round(400 - totalWidth / 2);
    const y = 160;
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < FRIENDSHIP_MAX; i += 1) {
      const srcX = i < this.friendship ? HEART_SRC_FULL_X : HEART_SRC_EMPTY_X;
      const destX = startX + i * (size + gap);
      ctx.drawImage(this.heartImage, srcX, 0, HEART_SIZE, HEART_SIZE, destX, y, size, size);
    }
  }
}

function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number): void {
  const ellipsis = "...";
  let next = text;
  while (next.length > ellipsis.length && ctx.measureText(next).width > maxWidth) {
    next = `${next.slice(0, -4)}${ellipsis}`;
  }
  ctx.fillText(next, x, y);
}

function drawPlate(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  const radius = 8;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
