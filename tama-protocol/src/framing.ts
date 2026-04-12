import { crc16Ibm } from "./crc";

export const CHUNK_MAGIC = new Uint8Array([0x54, 0x43, 0x50]); // "TCP"
export const CHUNK_HEADER_LENGTH = 12;
export const CHUNK_MAX_LENGTH = 0x1000;
export const NONCE_LENGTH = 4;

export interface Chunk {
  sessionId: number;
  msgType: number;
  chunkIndex: number;
  chunkIndexComp: number;
  crc: number;
  payload: Uint8Array;
}

export function createChunk(
  sessionId: number,
  msgType: number,
  chunkIndex: number,
  payload: Uint8Array
): Uint8Array {
  if (payload.length > CHUNK_MAX_LENGTH) {
    throw new Error(`chunk payload too large: ${payload.length}`);
  }

  const out = new Uint8Array(CHUNK_HEADER_LENGTH + payload.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(0, sessionId >>> 0, true);
  out.set(CHUNK_MAGIC, 4);
  view.setUint8(7, msgType & 0xff);
  view.setUint8(8, chunkIndex & 0xff);
  view.setUint8(9, 0xff - (chunkIndex & 0xff));
  view.setUint16(10, crc16Ibm(payload), true);
  out.set(payload, CHUNK_HEADER_LENGTH);
  return out;
}

export function parseChunk(data: Uint8Array): Chunk {
  if (data.length < CHUNK_HEADER_LENGTH) {
    throw new Error(`chunk too short: ${data.length}`);
  }

  if (data[4] !== CHUNK_MAGIC[0] || data[5] !== CHUNK_MAGIC[1] || data[6] !== CHUNK_MAGIC[2]) {
    throw new Error("chunk magic mismatch");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunkIndex = view.getUint8(8);
  const chunkIndexComp = view.getUint8(9);
  if (((chunkIndex + chunkIndexComp) & 0xff) !== 0xff) {
    throw new Error("chunk index complement mismatch");
  }

  const payload = data.slice(CHUNK_HEADER_LENGTH);
  const crc = view.getUint16(10, true);
  const expected = crc16Ibm(payload);
  if (crc !== expected) {
    throw new Error(`chunk crc mismatch: got ${crc.toString(16)}, expected ${expected.toString(16)}`);
  }

  return {
    sessionId: view.getUint32(0, true),
    msgType: view.getUint8(7),
    chunkIndex,
    chunkIndexComp,
    crc,
    payload
  };
}

export function splitPayload(payload: Uint8Array, chunkSize = CHUNK_MAX_LENGTH): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    chunks.push(payload.slice(offset, Math.min(offset + chunkSize, payload.length)));
  }
  return chunks;
}

export function joinPayload(chunks: Chunk[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.payload.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk.payload, offset);
    offset += chunk.payload.length;
  }
  return out;
}
