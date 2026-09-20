/** Placement encoded in a Type-0 ghost's first close-up composite pose.
 * Matches TamaHome's GhostEditorService.DeriveOffsetsFromComposite. */
export interface GhostPlacement {
  eyeX: number;
  eyeY: number;
  mouthX: number;
  mouthY: number;
  bodyOnly: boolean;
}

const POSE = 0x600 + 0x70; // state 1, block 0 X; state 0 is blank
const BLOCK = 22;

function precomposed(ghost: Uint8Array): boolean {
  if (ghost.length < 0x120) return false;
  const view = new DataView(ghost.buffer, ghost.byteOffset, ghost.byteLength);
  const a = view.getUint32(0x110, true);
  const n = view.getUint32(0x114, true);
  const b = view.getUint32(0x118, true);
  if (!a || !b || !n || n !== view.getUint32(0x11c, true) || a + n > ghost.length || b + n > ghost.length) return false;
  for (let i = 0; i < n; i++) if (ghost[a + i] !== ghost[b + i]) return false;
  return true;
}

export function ghostPlacement(ghost: Uint8Array, bodyHeight: number, eyeHeight: number, mouthHeight: number): GhostPlacement | null {
  if (ghost.length < POSE + 3 * BLOCK || (ghost[8]! & 3) !== 0) return null;
  if (precomposed(ghost)) return { eyeX: 0, eyeY: 0, mouthX: 0, mouthY: 0, bodyOnly: true };
  if (ghost.subarray(POSE, POSE + 3 * BLOCK).every((byte) => byte === 0xff)) return null;
  const view = new DataView(ghost.buffer, ghost.byteOffset, ghost.byteLength);
  const point = (part: number) => ({
    x: view.getInt16(POSE + part * BLOCK, true),
    y: view.getInt16(POSE + part * BLOCK + 2, true),
  });
  const body = point(0);
  const eye = point(1);
  const mouth = point(2);
  return {
    eyeX: eye.x - body.x,
    eyeY: eye.y - body.y + Math.trunc((bodyHeight - eyeHeight) / 2),
    mouthX: mouth.x - body.x,
    mouthY: mouth.y - body.y + Math.trunc((bodyHeight - mouthHeight) / 2),
    bodyOnly: false,
  };
}
