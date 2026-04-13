import { Drawer } from "./drawer";
import { Object2d } from "./object2d";
import { CompositedGhost } from "../ghost-compositor";
import { GhostPreview } from "../ghost-preview";

const FRIENDSHIP_MAX = 4;
// 48x16 "horizontal half heart" strip frames, in order: full, half, empty.
// Half is used as the mid-frame when a heart fills in (empty → half → full).
const HEART_SRC_FULL_X = 0;
const HEART_SRC_HALF_X = 16;
const HEART_SRC_EMPTY_X = 32;
const HEART_SIZE = 16;

// Per-heart fill animation: total time per heart, with a stagger between
// successive hearts so the eye follows a left-to-right wave.
const HEART_FILL_MS = 320;
const HEART_STAGGER_MS = 90;

// Egg sprite from Tamaweb (CC BY-NC-SA, attributed). 32x16 sheet, 2 frames:
// frame 0 = idle, frame 1 = cracked/wobble. In Paradise the egg never
// actually hatches — it just sits there post-breed — so we mirror that:
// enter → sway → settle on the cracked frame, wobbling gently, forever
// (or until the next playdate clears it).
const EGG_SRC_IDLE_X = 0;
const EGG_SRC_WOBBLE_X = 16;
const EGG_FRAME_SIZE = 16;
const EGG_DRAW_SCALE = 4; // 16 -> 64px on canvas
const EGG_CX = 400; // centered between the two ghosts
const EGG_CY = 280; // lower than hearts, between ghost bodies

// Egg lifecycle (ms from triggerEggHatch):
//   0..ENTER_END        : scale 0 → 1.15 → 1 (easeOutBack overshoot)
//   ENTER_END..SWAY_END : idle frame, sway accelerates
//   SWAY_END..           : cracked frame, gentle indefinite wobble
const EGG_ENTER_END = 600;
const EGG_SWAY_END = 3200;

interface HeartFillAnim {
  startedAt: number;
  fromLevel: number;
  toLevel: number;
}

interface EggHatch {
  startedAt: number;
}

export class Scene {
  private localGhost?: Object2d;
  private peerGhost?: Object2d;
  private localLabel = "your tama";
  private peerLabel = "peer tama";
  private status = "native link ready";
  private friendship: number | undefined;
  private heartImage: HTMLImageElement | undefined;
  private heartFill: HeartFillAnim | undefined;
  private eggImage: HTMLImageElement | undefined;
  private egg: EggHatch | undefined;

  constructor(private readonly drawer: Drawer) {
    const heart = new Image();
    heart.onload = () => { this.heartImage = heart; };
    heart.src = "/sprites/heart.png";

    const egg = new Image();
    egg.onload = () => { this.eggImage = egg; };
    egg.src = "/sprites/egg.png";
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

    // A new playdate is starting (fresh ghost arriving). Clear the egg
    // from any previous breeding so the scene resets cleanly.
    this.egg = undefined;
  }

  setStatus(status: string): void {
    this.status = status;
  }

  setFriendship(level: number): void {
    const next = Math.max(0, Math.min(FRIENDSHIP_MAX, Math.round(level)));
    if (this.friendship !== undefined && next > this.friendship) {
      // Animate empty→half→full sweep for the newly-filled hearts.
      this.heartFill = {
        startedAt: performance.now(),
        fromLevel: this.friendship,
        toLevel: next
      };
    }
    this.friendship = next;
  }

  /** Trigger the egg entrance (call once on SYNC 2 / breeding complete). */
  triggerEggHatch(): void {
    if (this.egg) return;
    this.egg = { startedAt: performance.now() };
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
    this.drawEgg(ctx);
    ctx.restore();
  }

  private drawFriendshipHearts(ctx: CanvasRenderingContext2D): void {
    if (this.friendship === undefined || !this.heartImage) return;
    const scale = 2;
    const size = HEART_SIZE * scale;
    const gap = 4;
    const totalWidth = FRIENDSHIP_MAX * size + (FRIENDSHIP_MAX - 1) * gap;
    const startX = Math.round(400 - totalWidth / 2);
    const y = 160;
    ctx.imageSmoothingEnabled = false;

    const fill = this.heartFill;
    const now = performance.now();
    let activeAnim = false;

    for (let i = 0; i < FRIENDSHIP_MAX; i += 1) {
      // Determine sprite frame for this slot. If we're animating a fill and
      // this heart is in the newly-filled range [fromLevel..toLevel), pick the
      // intermediate frame based on progress.
      let srcX: number;
      if (fill && i >= fill.fromLevel && i < fill.toLevel) {
        const startFor = fill.startedAt + (i - fill.fromLevel) * HEART_STAGGER_MS;
        const local = (now - startFor) / HEART_FILL_MS;
        if (local < 0) {
          srcX = HEART_SRC_EMPTY_X;
          activeAnim = true;
        } else if (local < 0.5) {
          srcX = HEART_SRC_HALF_X; // empty → half (first half of transition)
          activeAnim = true;
        } else if (local < 1) {
          // half → full: stay on full but with a tiny pulse so the eye catches it
          srcX = HEART_SRC_FULL_X;
          activeAnim = true;
        } else {
          srcX = HEART_SRC_FULL_X;
        }
      } else {
        srcX = i < this.friendship ? HEART_SRC_FULL_X : HEART_SRC_EMPTY_X;
      }

      const destX = startX + i * (size + gap);
      // Subtle pulse on the freshly-animated heart at peak (easeOutCubic on local).
      let pulse = 1;
      if (fill && i >= fill.fromLevel && i < fill.toLevel) {
        const startFor = fill.startedAt + (i - fill.fromLevel) * HEART_STAGGER_MS;
        const local = (now - startFor) / HEART_FILL_MS;
        if (local >= 0 && local <= 1) {
          // easeOutCubic peak around local=0.7
          const t = Math.max(0, Math.min(1, local));
          const lift = Math.sin(Math.PI * t);
          pulse = 1 + lift * 0.18;
        }
      }
      const drawSize = size * pulse;
      const offset = (drawSize - size) / 2;
      ctx.drawImage(this.heartImage, srcX, 0, HEART_SIZE, HEART_SIZE, destX - offset, y - offset, drawSize, drawSize);
    }

    if (fill && now - fill.startedAt > HEART_FILL_MS + HEART_STAGGER_MS * (FRIENDSHIP_MAX + 1)) {
      this.heartFill = undefined;
    } else if (activeAnim) {
      // The Drawer loop already redraws every frame, no manual schedule needed.
    }
  }

  private drawEgg(ctx: CanvasRenderingContext2D): void {
    if (!this.egg || !this.eggImage) return;
    const t = performance.now() - this.egg.startedAt;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const drawSize = EGG_FRAME_SIZE * EGG_DRAW_SCALE;
    let scale = 1;
    let dx = 0;
    let frameX = EGG_SRC_IDLE_X;

    if (t < EGG_ENTER_END) {
      // easeOutBack: scale 0 → 1.15 → 1. Squash-and-stretch arrival.
      scale = easeOutBack(t / EGG_ENTER_END);
    } else if (t < EGG_SWAY_END) {
      // Accelerating idle sway before the crack.
      const swayT = (t - EGG_ENTER_END) / (EGG_SWAY_END - EGG_ENTER_END);
      const speed = 0.005 + swayT * swayT * 0.025;
      const phase = (t - EGG_ENTER_END) * speed;
      dx = Math.sin(phase) * (2 + swayT * 4);
    } else {
      // Post-sway: cracked frame, gentle rocking indefinitely. Paradise
      // never actually hatches the egg — so neither do we.
      frameX = EGG_SRC_WOBBLE_X;
      dx = Math.sin(t * 0.004) * 3;
      scale = 1 + Math.sin(t * 0.003) * 0.02;
    }

    const x = Math.round(EGG_CX + dx - (drawSize * scale) / 2);
    const y = Math.round(EGG_CY - (drawSize * scale) / 2);
    ctx.drawImage(
      this.eggImage,
      frameX, 0, EGG_FRAME_SIZE, EGG_FRAME_SIZE,
      x, y, drawSize * scale, drawSize * scale
    );
    ctx.restore();
  }
}

// easeOutBack with overshoot=1.7 → peaks slightly above 1 then settles.
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.max(0, Math.min(1, t));
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
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
