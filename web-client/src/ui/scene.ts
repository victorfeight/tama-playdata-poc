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
// frame 0 = idle, frame 1 = wobble (hatching). Same usage pattern as
// Tamaweb's Pet.handleEgg() — sin() sway with accelerating speed, swap to
// frame 1 at peak speed, then a flash + particle burst for the hatch.
const EGG_SRC_IDLE_X = 0;
const EGG_SRC_WOBBLE_X = 16;
const EGG_FRAME_SIZE = 16;
const EGG_DRAW_SCALE = 4; // 16 -> 64px on canvas
const EGG_CX = 400; // centered between the two ghosts
const EGG_CY = 280; // lower than hearts, between ghost bodies

// Egg lifecycle (ms from triggerEggHatch):
//   0..ENTER_END        : scale 0 → 1.15 → 1 (easeOutBack overshoot)
//   ENTER_END..SWAY_END : idle frame, sway accelerates (Tamaweb pattern)
//   SWAY_END..WOBBLE_END: wobble frame, faster shake + small horizontal jitter
//   WOBBLE_END..FLASH_END: white flash overlay fades + 12-spoke particle ring
//   FLASH_END..          : scene clears the egg
const EGG_ENTER_END = 600;
const EGG_SWAY_END = 3200;
const EGG_WOBBLE_END = 4000;
const EGG_FLASH_END = 4900;

interface HeartFillAnim {
  startedAt: number;
  fromLevel: number;
  toLevel: number;
}

interface EggHatch {
  startedAt: number;
}

// Baby placeholder shown after the egg dissolves. Composited from the
// BABYMARUTCHI sprite set (id 1001 in CharacterDataEmbedded — eye 0,30 /
// mouth 0,32). Drawn at native size (64x64) so its footprint matches the
// hatched egg's footprint above. Persists until the next playdate
// (showGhost) clears it.
interface BabyState {
  bornAt: number;
}
// Squash-and-stretch entrance: same easeOutBack curve as the egg's arrival,
// so the two beats rhyme visually (egg pops in → baby pops in).
const BABY_BIRTH_MS = 520;
// Per CharacterDataEmbedded id 1001 (BABYMARUTCHI): eyeX=0, eyeY=30,
// mouthX=0, mouthY=32. These are pixel offsets from the body sprite's
// top-left, in the same coordinate system the assets use.
const BABY_EYE_X = 0;
const BABY_EYE_Y = 30;
const BABY_MOUTH_X = 0;
const BABY_MOUTH_Y = 32;
// Slight upscale: the canvas is CSS-scaled to fit the device column,
// which softens edges on a 1:1 sprite. 1.5x keeps the silhouette tight
// even after CSS shrink.
const BABY_DRAW_SCALE = 1.25;
// Baby sits a bit higher than the egg so its center lines up with where
// the egg visually was (the egg renders smaller than the scaled baby would).
const BABY_CY = EGG_CY - 24;

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
  private babyBody: HTMLImageElement | undefined;
  private babyEyes: HTMLImageElement | undefined;
  private babyMouth: HTMLImageElement | undefined;
  private baby: BabyState | undefined;

  constructor(private readonly drawer: Drawer) {
    const heart = new Image();
    heart.onload = () => { this.heartImage = heart; };
    heart.src = "/sprites/heart.png";

    const egg = new Image();
    egg.onload = () => { this.eggImage = egg; };
    egg.src = "/sprites/egg.png";

    const loadBaby = (key: "babyBody" | "babyEyes" | "babyMouth", file: string) => {
      const img = new Image();
      img.onload = () => { this[key] = img; };
      img.src = `/sprites/baby/${file}.png`;
    };
    loadBaby("babyBody", "body");
    loadBaby("babyEyes", "eyes");
    loadBaby("babyMouth", "mouth");
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

    // A new playdate is starting (fresh ghost arriving). Clear the baby +
    // egg from any previous breeding so the scene resets cleanly.
    this.baby = undefined;
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

  /** Trigger the egg hatch sequence (call on SYNC 2 / breeding complete). */
  triggerEggHatch(): void {
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
    this.drawBaby(ctx);
    ctx.restore();
  }

  private drawBaby(ctx: CanvasRenderingContext2D): void {
    if (!this.baby || !this.babyBody) return;
    const t = performance.now() - this.baby.bornAt;
    // easeOutBack scale-pop during birth, then settles to full and bobs.
    const birthP = Math.min(1, Math.max(0, t / BABY_BIRTH_MS));
    const popScale = t < BABY_BIRTH_MS ? easeOutBack(birthP) : 1;
    if (popScale <= 0) return;

    const s = BABY_DRAW_SCALE * popScale;
    const bodyW = this.babyBody.naturalWidth * s;
    const bodyH = this.babyBody.naturalHeight * s;
    // Bob only after the birth pop completes — feels grounded, not jittery.
    const bob = t < BABY_BIRTH_MS ? 0 : Math.sin(performance.now() / 520) * 4;
    const bodyX = EGG_CX - bodyW / 2;
    const bodyY = BABY_CY - bodyH / 2 + bob;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.babyBody, bodyX, bodyY, bodyW, bodyH);
    if (this.babyEyes) {
      const ew = this.babyEyes.naturalWidth * s;
      const eh = this.babyEyes.naturalHeight * s;
      ctx.drawImage(this.babyEyes, bodyX + BABY_EYE_X * s, bodyY + BABY_EYE_Y * s, ew, eh);
    }
    if (this.babyMouth) {
      const mw = this.babyMouth.naturalWidth * s;
      const mh = this.babyMouth.naturalHeight * s;
      ctx.drawImage(this.babyMouth, bodyX + BABY_MOUTH_X * s, bodyY + BABY_MOUTH_Y * s, mw, mh);
    }
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
    if (t > EGG_FLASH_END) {
      this.egg = undefined;
      return;
    }

    // Spawn the baby slightly BEFORE the egg fully dissolves so the two
    // beats overlap — egg fades while baby pops, the white halo masks the
    // moment they swap. Trigger once, mid-flash.
    const eggSpawnThreshold = EGG_WOBBLE_END + (EGG_FLASH_END - EGG_WOBBLE_END) * 0.35;
    if (t > eggSpawnThreshold && !this.baby) {
      this.baby = { bornAt: performance.now() };
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const drawSize = EGG_FRAME_SIZE * EGG_DRAW_SCALE;
    let scale = 1;
    let dx = 0;
    let frameX = EGG_SRC_IDLE_X;

    if (t < EGG_ENTER_END) {
      // easeOutBack: scale 0 → 1.15 → 1. Classic squash-and-stretch arrival.
      const p = t / EGG_ENTER_END;
      scale = easeOutBack(p);
    } else if (t < EGG_SWAY_END) {
      // Tamaweb's pattern: motion speed accelerates from 0 to ~0.02 over time.
      const swayT = (t - EGG_ENTER_END) / (EGG_SWAY_END - EGG_ENTER_END);
      const speed = 0.005 + swayT * swayT * 0.025; // accelerating
      const phase = (t - EGG_ENTER_END) * speed;
      dx = Math.sin(phase) * (2 + swayT * 4);
    } else if (t < EGG_WOBBLE_END) {
      // Wobble frame + faster shake (random-feeling but deterministic via sin).
      frameX = EGG_SRC_WOBBLE_X;
      const wobbleT = (t - EGG_SWAY_END) / (EGG_WOBBLE_END - EGG_SWAY_END);
      dx = Math.sin(t * 0.06) * (4 + wobbleT * 3);
      scale = 1 + Math.sin(t * 0.04) * 0.04;
    } else {
      // Flash: egg stays on the cracked frame (Tamaweb pattern: once you
      // swap to cellNumber 2, you don't go back) and fades while a white
      // ring + particle spokes radiate out.
      frameX = EGG_SRC_WOBBLE_X;
      const flashT = (t - EGG_WOBBLE_END) / (EGG_FLASH_END - EGG_WOBBLE_END);
      const eggAlpha = 1 - flashT;
      ctx.globalAlpha = Math.max(0, eggAlpha);
      scale = 1 - flashT * 0.2;
      drawFlash(ctx, EGG_CX, EGG_CY, flashT);
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

// 12-spoke particle ring + soft white halo. Pure procedural Canvas 2D —
// no image, no particle system overhead. Simulates the Tamaweb hatch flash
// (white overlay fading) but localized to the egg, not full-screen, so it
// doesn't blow out the rest of the scene.
function drawFlash(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number): void {
  // Halo
  const haloRadius = 24 + t * 90;
  const haloAlpha = (1 - t) * 0.55;
  ctx.save();
  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, haloRadius);
  grad.addColorStop(0, `rgba(255, 253, 240, ${haloAlpha})`);
  grad.addColorStop(1, "rgba(255, 253, 240, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spokes
  const spokes = 12;
  const minR = 16 + t * 30;
  const maxR = minR + 22 + t * 60;
  const alpha = (1 - t) * 0.85;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 2;
  for (let i = 0; i < spokes; i += 1) {
    const a = (i / spokes) * Math.PI * 2;
    const x0 = cx + Math.cos(a) * minR;
    const y0 = cy + Math.sin(a) * minR;
    const x1 = cx + Math.cos(a) * maxR;
    const y1 = cy + Math.sin(a) * maxR;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
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
