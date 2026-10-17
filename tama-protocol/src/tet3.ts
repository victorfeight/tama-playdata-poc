import { crc32 } from "./crc";
// Recovered from capture SHA256 657be002...289b37c; see docs/TETRIS_DEMO.md.
// Shared bounded codec. The observer stays passive; host sessions are separate.
export interface Tet3Packet {
  session: number; sequence: number; type: number; round: number;
  a: number; b: number; c: number;
}


export function encodeTet3(packet: Tet3Packet): Uint8Array {
  const raw = new Uint8Array(36);
  const view = new DataView(raw.buffer);
  [0x33544554, packet.session, packet.sequence, packet.type, packet.round,
    packet.a, packet.b, packet.c].forEach((word, i) => view.setUint32(i * 4, word, true));
  view.setUint32(32, crc32(raw.subarray(0, 32)), true);
  const frame = new Uint8Array(39);
  let codeAt = 1, cursor = 2, code = 1;
  for (const byte of raw) {
    if (byte === 0) { frame[codeAt] = code; codeAt = cursor++; code = 1; }
    else { frame[cursor++] = byte; code++; }
  }
  frame[codeAt] = code;
  return frame;
}

export class Tet3Observer {
  private encoded: number[] = [];
  private discard = false;
  invalid = 0;

  reset(): void { this.encoded = []; this.discard = false; this.invalid = 0; }

  push(bytes: Uint8Array): Tet3Packet[] {
    const packets: Tet3Packet[] = [];
    for (const byte of bytes) {
      if (byte !== 0) {
        if (!this.discard) {
          if (this.encoded.length === 40) { this.discard = true; this.invalid++; }
          else this.encoded.push(byte);
        }
        continue;
      }
      if (!this.discard && this.encoded.length) {
        const packet = this.decode(this.encoded);
        if (packet) packets.push(packet); else this.invalid++;
      }
      this.encoded = [];
      this.discard = false;
    }
    return packets;
  }

  private decode(encoded: number[]): Tet3Packet | undefined {
    const raw: number[] = [];
    let i = 0;
    while (i < encoded.length) {
      const code = encoded[i++]!;
      if (!code || i + code - 1 > encoded.length) return;
      for (let n = 1; n < code; n++) raw.push(encoded[i++]!);
      if (code < 255 && i < encoded.length) raw.push(0);
      if (raw.length > 36) return;
    }
    if (raw.length !== 36) return;
    const bytes = Uint8Array.from(raw), view = new DataView(bytes.buffer);
    if (view.getUint32(0, true) !== 0x33544554 ||
        view.getUint32(32, true) !== crc32(bytes.subarray(0, 32))) return;
    return { session: view.getUint32(4, true), sequence: view.getUint32(8, true),
      type: view.getUint32(12, true), round: view.getUint32(16, true),
      a: view.getUint32(20, true), b: view.getUint32(24, true), c: view.getUint32(28, true) };
  }
}
