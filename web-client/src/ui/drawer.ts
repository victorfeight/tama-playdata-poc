import { Object2d } from "./object2d";

export class Drawer {
  private objects: Object2d[] = [];
  private lastTime = performance.now();
  private raf = 0;
  private readonly backdrop = new Image();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx = canvas.getContext("2d") as CanvasRenderingContext2D
  ) {
    this.ctx.imageSmoothingEnabled = false;
    this.backdrop.src = "/sprites/unexists-banner.png";
  }

  add(object: Object2d): Object2d {
    this.objects.push(object);
    return object;
  }

  clear(): void {
    this.objects = [];
  }

  start(): void {
    const frame = (time: number) => {
      const delta = time - this.lastTime;
      this.lastTime = time;
      this.draw(delta);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  draw(deltaMs: number): void {
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    drawImageBackdrop(this.ctx, this.backdrop, width, height);
    for (const object of [...this.objects].sort((a, b) => a.z - b.z)) object.draw(this.ctx, deltaMs);
  }
}

function drawImageBackdrop(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number): void {
  ctx.fillStyle = "#f5ebda";
  ctx.fillRect(0, 0, width, height);

  if (image.complete && image.naturalWidth > 0) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(255, 253, 247, 0.08)");
  gradient.addColorStop(0.55, "rgba(255, 253, 247, 0.16)");
  gradient.addColorStop(1, "rgba(31, 37, 32, 0.18)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#1f2520";
  ctx.lineWidth = 5;
  ctx.strokeRect(14, 14, width - 28, height - 28);
}
