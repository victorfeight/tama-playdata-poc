// Passive observer of a Paradise TCP stream in ONE direction.
//
// Behaviour is a straight passive port of TAMA_NEW/GhostCapture/TcpComm.cs.
// Unlike TcpComm it never writes to the wire -- it only consumes bytes pushed
// in via `push()` and emits complete plaintext packets.
//
// Keystreams are per-packet-chunk (nonce || SECRET -> SHA256), so there is no
// cross-packet drift and passive decryption is reliable as long as framing is
// correct. Framing matches TcpChunk.cs exactly (magic "TCP", 12-byte header,
// chunk index + 0xFF complement, CRC16-IBM over payload).

import { CHUNK_HEADER_LENGTH, CHUNK_MAX_LENGTH, NONCE_LENGTH, parseChunk } from "./framing";
import { tcpCrypt } from "./tcp-crypto";

export interface ObservedPacket {
  msgType: number;       // low 4 bits (payload type)
  rawMsgType: number;    // full byte including flags (0x10 = set session id)
  sessionId: number;
  payload: Uint8Array;
}

// High nibble of msgType signals protocol-level operations, not game data.
// 0x10 = "set session ID" packet; payload is 2 random bytes. See
// tama-para-research/protocols/tcp.md §Set session ID.
export const MSG_FLAG_SET_SESSION_ID = 0x10;

export interface TcpObserverEvents {
  packet?(packet: ObservedPacket): void;
  command?(line: string): void;
  error?(message: string): void;
  resync?(reason: string, totalResyncs: number): void;
}

type Phase =
  | { kind: "idle" }
  | {
      kind: "receiving";
      totalLength: number;
      totalChunks: number;
      nextChunkIndex: number;
      chunks: Uint8Array[];
      lastMsgType: number;
      lastSessionId: number;
    };

const decoder = new TextDecoder("ascii");

export class TcpObserver {
  private buffer: Uint8Array = new Uint8Array();
  private phase: Phase = { kind: "idle" };
  private draining = false;
  private resyncCount = 0;

  constructor(private readonly events: TcpObserverEvents = {}) {}

  get resyncs(): number {
    return this.resyncCount;
  }

  reset(): void {
    this.buffer = new Uint8Array();
    this.phase = { kind: "idle" };
  }

  push(data: Uint8Array): void {
    if (data.length === 0) return;
    this.buffer = concat(this.buffer, data);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        // push() may be called synchronously while we are awaiting a
        // consumeChunk(); in that case the buffer grows behind our back and
        // consumeChunk's first-line length check returns false with a stale
        // view. Snapshot before each step so we can retry when the buffer
        // outgrew the reason consumeChunk bailed.
        const before = this.buffer.length;
        if (this.phase.kind === "idle") {
          if (!this.consumeCommandLine()) {
            if (this.buffer.length > before) continue;
            return;
          }
        } else {
          if (!(await this.consumeChunk())) {
            if (this.buffer.length > before) continue;
            return;
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  // Returns true if a line was consumed (keep draining), false if we need more bytes.
  private consumeCommandLine(): boolean {
    // Look for \r\n but allow leading binary garbage (e.g. we started mid-stream).
    const crlf = findCrlf(this.buffer);
    if (crlf === -1) {
      // If the buffer is getting long without a CRLF AND contains non-ASCII, drop
      // everything before the last potential ASCII region. Keep ≤64 bytes max to
      // avoid unbounded growth when we are genuinely mid-binary without a PKT.
      if (this.buffer.length > 4096) {
        this.buffer = this.buffer.slice(this.buffer.length - 64);
      }
      return false;
    }

    const line = decoder.decode(this.buffer.slice(0, crlf)).trim();
    this.buffer = this.buffer.slice(crlf + 2);
    if (line.length === 0) return true;
    this.events.command?.(line);

    const match = /^PKT\s+(\d+)$/i.exec(line);
    if (!match) {
      // ACK / NAK / CAN / SYNC / BREED etc. -- irrelevant to passive decoding.
      return true;
    }
    const totalLength = Number(match[1]);
    if (!Number.isFinite(totalLength) || totalLength <= 0) return true;
    const totalChunks = Math.ceil(totalLength / CHUNK_MAX_LENGTH);
    this.phase = {
      kind: "receiving",
      totalLength,
      totalChunks,
      nextChunkIndex: 0,
      chunks: [],
      lastMsgType: 0,
      lastSessionId: 0
    };
    return true;
  }

  private async consumeChunk(): Promise<boolean> {
    if (this.phase.kind !== "receiving") return false;
    const chunkLen = this.currentChunkLength();
    const wireLen = NONCE_LENGTH + CHUNK_HEADER_LENGTH + chunkLen;
    if (this.buffer.length < wireLen) return false;

    const wire = this.buffer.slice(0, wireLen);
    const nonce = wire.slice(0, NONCE_LENGTH);
    const encrypted = wire.slice(NONCE_LENGTH);

    let chunk;
    try {
      const decrypted = await tcpCrypt(nonce, encrypted);
      chunk = parseChunk(decrypted);
    } catch (error) {
      // Chunk didn't parse. Possible causes:
      //   - we joined mid-stream and framing is off
      //   - retransmit aligned weirdly
      //   - wire corruption (CRC mismatch)
      // Advance by 1 byte and try to re-sync at next CRLF. This is cheap;
      // passive observation can afford to resync.
      const reason = error instanceof Error ? error.message : String(error);
      this.resyncCount += 1;
      this.events.error?.(`chunk parse failed: ${reason}`);
      this.events.resync?.(reason, this.resyncCount);
      this.buffer = this.buffer.slice(1);
      this.phase = { kind: "idle" };
      return true;
    }

    this.buffer = this.buffer.slice(wireLen);

    if (chunk.chunkIndex !== this.phase.nextChunkIndex) {
      // Retransmit of previous chunk or out-of-order; ignore.
      return true;
    }

    this.phase.chunks.push(chunk.payload.slice(0, chunkLen));
    this.phase.lastMsgType = chunk.msgType;
    this.phase.lastSessionId = chunk.sessionId;
    this.phase.nextChunkIndex += 1;

    if (this.phase.nextChunkIndex >= this.phase.totalChunks) {
      const payload = joinChunks(this.phase.chunks, this.phase.totalLength);
      const packet: ObservedPacket = {
        msgType: this.phase.lastMsgType & 0x0f,
        rawMsgType: this.phase.lastMsgType,
        sessionId: this.phase.lastSessionId,
        payload
      };
      this.phase = { kind: "idle" };
      this.events.packet?.(packet);
    }
    return true;
  }

  private currentChunkLength(): number {
    if (this.phase.kind !== "receiving") return 0;
    const { nextChunkIndex, totalChunks, totalLength } = this.phase;
    if (nextChunkIndex === totalChunks - 1) {
      return totalLength - nextChunkIndex * CHUNK_MAX_LENGTH;
    }
    if (nextChunkIndex >= totalChunks) return 0;
    return CHUNK_MAX_LENGTH;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function findCrlf(data: Uint8Array): number {
  for (let i = 0; i + 1 < data.length; i += 1) {
    if (data[i] === 0x0d && data[i + 1] === 0x0a) return i;
  }
  return -1;
}

function joinChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    const write = Math.min(chunk.length, totalLength - offset);
    out.set(chunk.subarray(0, write), offset);
    offset += write;
    if (offset >= totalLength) break;
  }
  return out;
}
