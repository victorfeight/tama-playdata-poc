import { crc32 } from "./crc";
import { UartChannel } from "./uart-channel";

export interface MediaProgress { completed: number; total: number; written: number; matched: number }
const HEADER = 128, RECORD = 36, SECTOR = 4096, BANK = 0xf00000;
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const ascii = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Exact narrow music-only v2 stream; not the animated THC1 full-flash API.
 * Source: SDK tools/send_stream_launch.py and stream-launch/receiver.c.
 */
export function validateMusicBundle(bundle: Uint8Array, profile: string, sectors: number): Uint8Array[] {
  if (!Number.isInteger(sectors) || sectors < 1 || sectors > 256 || bundle.length !== HEADER + sectors * (RECORD + SECTOR)) throw new Error("Invalid music stream size.");
  const header = view(bundle);
  if (ascii(bundle.subarray(0, 8)) !== "TPFWPK01" || header.getUint16(8, true) !== 2 || header.getUint16(10, true) !== HEADER ||
      header.getUint32(12, true) !== 3 || header.getUint32(16, true) !== SECTOR || header.getUint32(20, true) !== sectors ||
      ascii(bundle.subarray(24, 40)).replace(/\0.*$/s, "") !== profile || header.getUint32(124, true) !== crc32(bundle.subarray(0, 124))) throw new Error("Invalid music stream header.");
  const erasedCrc = crc32(new Uint8Array(SECTOR).fill(255));
  const records: Uint8Array[] = [];
  for (let sequence = 0; sequence < sectors; sequence++) {
    const record = bundle.subarray(HEADER + sequence * (RECORD + SECTOR), HEADER + (sequence + 1) * (RECORD + SECTOR));
    const r = view(record), sector = sequence === sectors - 1 ? 0 : sequence + 1;
    if (ascii(record.subarray(0, 4)) !== "TFS1" || r.getUint32(4, true) !== sequence || r.getUint32(8, true) !== BANK + sector * SECTOR ||
        r.getUint16(12, true) !== SECTOR || r.getUint16(14, true) !== SECTOR || record[16] !== 0 || record[17] !== 2 || r.getUint16(18, true) !== 0 ||
        r.getUint32(20, true) !== erasedCrc || r.getUint32(24, true) !== crc32(record.subarray(RECORD)) ||
        r.getUint32(28, true) !== r.getUint32(24, true) || r.getUint32(32, true) !== crc32(record.subarray(0, 32))) throw new Error(`Invalid music sector ${sequence + 1}.`);
    records.push(record);
  }
  return records;
}

export async function readMediaResponse(channel: UartChannel, expected: number, timeout: number, phase: string): Promise<number> {
  const deadline = performance.now() + timeout;
  const magic = [84, 80, 82, 49]; let matched = 0;
  while (matched < 4) {
    const byte = (await channel.exact(1, deadline - performance.now()))[0]!;
    matched = byte === magic[matched] ? matched + 1 : byte === magic[0] ? 1 : 0;
  }
  const frame = new Uint8Array(16); frame.set(magic);
  frame.set(await channel.exact(12, deadline - performance.now()), 4);
  const data = view(frame);
  if (data.getUint16(10, true) !== 0 || data.getUint32(12, true) !== crc32(frame.subarray(0, 12))) throw new Error(`Damaged device reply during ${phase}. Stop and check the toy before retrying.`);
  if (data.getUint32(4, true) !== expected) throw new Error(`Unexpected device reply during ${phase}. Stop and check the toy before retrying.`);
  if (frame[8] !== 0) {
    if (expected === 0xfffffffc && frame[8] === 3) {
      if (frame[9] === 2) throw new Error("This firmware is not supported by this music installer. No music sectors were written. Press C to return home.");
      if (frame[9] === 3) throw new Error("The music space contains other data. Nothing was erased. Press C to return home.");
    }
    throw new Error(`The toy stopped ${phase} (code ${frame[8]}, detail ${frame[9]}). Follow its screen before retrying.`);
  }
  return frame[9]!;
}

export async function streamMusic(channel: UartChannel, bundle: Uint8Array, records: readonly Uint8Array[],
  progress: (value: MediaProgress) => void): Promise<MediaProgress> {
  await readMediaResponse(channel, 0xfffffffc, 120_000, "firmware and music-space check");
  await channel.write(bundle.subarray(0, HEADER));
  await readMediaResponse(channel, 0xfffffffe, 10_000, "music header");
  const result = { completed: 0, total: records.length, written: 0, matched: 0 };
  progress({ ...result });
  for (let sequence = 0; sequence < records.length; sequence++) {
    const record = records[sequence]!;
    await channel.write(record.subarray(0, RECORD));
    const disposition = await readMediaResponse(channel, sequence, 10_000, "music sector check");
    if (disposition === 2) result.matched++;
    else if (disposition === 0) {
      await channel.write(record.subarray(RECORD));
      if (await readMediaResponse(channel, sequence, 30_000, "music sector verification") !== 1) throw new Error("The toy did not verify the music sector.");
      result.written++;
    } else throw new Error("Invalid music sector status.");
    result.completed++; progress({ ...result });
  }
  await readMediaResponse(channel, 0xfffffffd, 60_000, "complete music verification");
  return result;
}
