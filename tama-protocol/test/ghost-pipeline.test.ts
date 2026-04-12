import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHUNK_MAX_LENGTH, createChunk, NONCE_LENGTH } from "../src/framing";
import { parseGhost } from "../src/ghost";
import { ObservedPacket, TcpObserver } from "../src/tcp-observer";
import { tcpCrypt } from "../src/tcp-crypto";

const FIXTURE = fileURLToPath(new URL("./fixtures/ghost_kuchipatchi.bin", import.meta.url));
const SESSION_ID = 0x11223344;
const MSG_TYPE = 1;
const textEncoder = new TextEncoder();

// Round-trip the fixture through the wire format the Paradise would use on
// the UART: `PKT <n>\r\n` then per-chunk `nonce(4) + tcpCrypt(nonce, chunk)`.
// Feeding this into TcpObserver must reassemble the exact original bytes.
// This is the observability baseline -- if this passes, any live failure
// is environmental (wire corruption, chip buffering, baud mismatch), not a
// code bug in the decrypt/parse chain.
async function buildWire(payload: Uint8Array): Promise<Uint8Array> {
  const header = textEncoder.encode(`PKT ${payload.length}\r\n`);
  const parts: Uint8Array[] = [header];
  const totalChunks = Math.ceil(payload.length / CHUNK_MAX_LENGTH);
  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * CHUNK_MAX_LENGTH;
    const end = Math.min(start + CHUNK_MAX_LENGTH, payload.length);
    const chunkPayload = payload.slice(start, end);
    const chunkBytes = createChunk(SESSION_ID, MSG_TYPE, i, chunkPayload);
    const nonce = new Uint8Array(NONCE_LENGTH);
    // deterministic per-chunk nonce so the test is reproducible
    const view = new DataView(nonce.buffer);
    view.setUint32(0, 0xcafe0000 + i, true);
    const encrypted = await tcpCrypt(nonce, chunkBytes);
    const frame = new Uint8Array(NONCE_LENGTH + encrypted.length);
    frame.set(nonce, 0);
    frame.set(encrypted, NONCE_LENGTH);
    parts.push(frame);
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function feedInPieces(observer: TcpObserver, wire: Uint8Array, sizes: number[]): void {
  let offset = 0;
  for (const size of sizes) {
    if (offset >= wire.length) break;
    const chunk = wire.slice(offset, Math.min(offset + size, wire.length));
    observer.push(chunk);
    offset += size;
  }
  if (offset < wire.length) {
    observer.push(wire.slice(offset));
  }
}

async function runPipeline(sizes: number[]): Promise<ObservedPacket[]> {
  const fixture = new Uint8Array(readFileSync(FIXTURE));
  const wire = await buildWire(fixture);

  const packets: ObservedPacket[] = [];
  const resyncs: string[] = [];
  const observer = new TcpObserver({
    packet: (p) => packets.push(p),
    resync: (reason) => resyncs.push(reason)
  });

  feedInPieces(observer, wire, sizes);
  // tcpCrypt awaits SHA-256 per chunk; poll briefly so all microtasks flush.
  for (let i = 0; i < 50 && packets.length === 0; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  expect(resyncs, `unexpected resyncs: ${resyncs.join("; ")}`).toHaveLength(0);
  return packets;
}

describe("ghost pipeline (wire -> observer -> parser)", () => {
  it("reassembles a full ghost when bytes arrive in one big chunk", async () => {
    const packets = await runPipeline([Number.MAX_SAFE_INTEGER]);
    expect(packets).toHaveLength(1);
    const packet = packets[0]!;
    const fixture = new Uint8Array(readFileSync(FIXTURE));
    expect(packet.msgType).toBe(MSG_TYPE);
    expect(packet.payload.length).toBe(fixture.length);
    expect(Buffer.from(packet.payload).equals(Buffer.from(fixture))).toBe(true);

    const ghost = parseGhost(packet.payload);
    expect(ghost.validChecksum).toBe(true);
  });

  it("reassembles correctly when bytes arrive in tiny fragments", async () => {
    const packets = await runPipeline([1, 7, 3, 128, 13, 1024, 5]);
    expect(packets).toHaveLength(1);
    const fixture = new Uint8Array(readFileSync(FIXTURE));
    expect(Buffer.from(packets[0]!.payload).equals(Buffer.from(fixture))).toBe(true);
    expect(parseGhost(packets[0]!.payload).validChecksum).toBe(true);
  });
});
