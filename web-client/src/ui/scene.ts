import { Drawer } from "./drawer";
import { Object2d } from "./object2d";
import { CompositedGhost } from "../ghost-compositor";
import { GhostPreview } from "../ghost-preview";

export class Scene {
  private localGhost?: Object2d;
  private peerGhost?: Object2d;
  private localLabel = "your tama";
  private peerLabel = "peer tama";
  private status = "native link ready";

  constructor(private readonly drawer: Drawer) {}

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
    this.status = rendered.details;
  }

  setStatus(status: string): void {
    this.status = status;
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
    ctx.restore();
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
