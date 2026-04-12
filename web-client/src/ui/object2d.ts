export interface Object2dOptions {
  img?: string;
  canvas?: HTMLCanvasElement;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z?: number;
  opacity?: number;
  flipX?: boolean;
  hidden?: boolean;
  onDraw?: (object: Object2d, ctx: CanvasRenderingContext2D, deltaMs: number) => void;
}

export class Object2d {
  image: HTMLImageElement | undefined;
  canvas: HTMLCanvasElement | undefined;
  x = 0;
  y = 0;
  width = 32;
  height = 32;
  z = 0;
  opacity = 1;
  flipX = false;
  hidden = false;
  onDraw?: (object: Object2d, ctx: CanvasRenderingContext2D, deltaMs: number) => void;

  constructor(options: Object2dOptions = {}) {
    Object.assign(this, options);
    if (options.img) {
      this.image = new Image();
      this.image.src = options.img;
    }
  }

  draw(ctx: CanvasRenderingContext2D, deltaMs: number): void {
    if (this.hidden) return;
    this.onDraw?.(this, ctx, deltaMs);
    ctx.save();
    ctx.globalAlpha = this.opacity;
    if (this.flipX) {
      ctx.translate(this.x + this.width, this.y);
      ctx.scale(-1, 1);
      if (this.canvas) ctx.drawImage(this.canvas, 0, 0, this.width, this.height);
      else if (this.image?.complete) ctx.drawImage(this.image, 0, 0, this.width, this.height);
    } else if (this.canvas) ctx.drawImage(this.canvas, this.x, this.y, this.width, this.height);
    else if (this.image?.complete) ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
    else {
      ctx.fillStyle = "#fcdb50";
      ctx.fillRect(this.x, this.y, this.width, this.height);
    }
    ctx.restore();
  }

  hitTest(x: number, y: number): boolean {
    return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
  }
}
