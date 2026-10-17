import { afterEach, describe, expect, it, vi } from "vitest";
import { crc32, createChunk, parseChunk, tcpCrypt, prepareDownload, sendDownload, UartChannel, streamMusic, validateMusicBundle, type Transport } from "@tama-breed-poc/tama-protocol";
import { GameInstallService } from "../../web-client/src/game-install-service";
import { SerialBridge } from "../../web-client/src/serial-bridge";
class Serial implements Transport {
  name = 'test'; writes: Uint8Array[] = []; reads = 0;
  private waiting: ((data: Uint8Array) => void) | undefined;
  private disconnected: ((error: Error) => void) | undefined;
  private failure: Error | undefined;
  private queue: Uint8Array[] = [];
  onWrite: (bytes: Uint8Array) => void = () => {};
  async read(): Promise<Uint8Array> {
    this.reads++; if (this.failure) throw this.failure;
    return this.queue.shift() ?? new Promise((resolve, reject) => { this.waiting = resolve; this.disconnected = reject; });
  }
  unplug() { this.failure = new Error('USB disconnected'); this.disconnected?.(this.failure); }
  async write(bytes: Uint8Array) { this.writes.push(bytes.slice()); this.onWrite(bytes); }
  async close() {}
  push(bytes: Uint8Array) { if (this.waiting) { const callback = this.waiting; this.waiting = undefined; callback(bytes); } else this.queue.push(bytes); }
  line(text: string) { this.push(new TextEncoder().encode(text + '\r\n')); }
}
function response(sequence: number, detail = 0, status = 0): Uint8Array {
  const bytes = new Uint8Array(16), v = new DataView(bytes.buffer);
  bytes.set([84, 80, 82, 49]); v.setUint32(4, sequence, true); bytes[8] = status; bytes[9] = detail;
  v.setUint32(12, crc32(bytes.subarray(0, 12)), true); return bytes;
}
function bundle() {
  const bytes = new Uint8Array(128 + 2 * 4132), v = new DataView(bytes.buffer), text = new TextEncoder();
  bytes.set(text.encode('TPFWPK01')); v.setUint16(8, 2, true); v.setUint16(10, 128, true); v.setUint32(12, 3, true);
  v.setUint32(16, 4096, true); v.setUint32(20, 2, true); bytes.set(text.encode('puzzle-music'), 24); v.setUint32(124, crc32(bytes.subarray(0, 124)), true);
  for (let i = 0; i < 2; i++) {
    const r = bytes.subarray(128 + i * 4132, 128 + (i + 1) * 4132), rv = new DataView(r.buffer, r.byteOffset, r.byteLength);
    r.set(text.encode('TFS1')); rv.setUint32(4, i, true); rv.setUint32(8, i ? 0xf00000 : 0xf01000, true);
    rv.setUint16(12, 4096, true); rv.setUint16(14, 4096, true); r[17] = 2;
    rv.setUint32(20, crc32(new Uint8Array(4096).fill(255)), true); r.fill(i + 1, 36);
    rv.setUint32(24, crc32(r.subarray(36)), true); rv.setUint32(28, crc32(r.subarray(36)), true); rv.setUint32(32, crc32(r.subarray(0, 32)), true);
  } return bytes;
}
afterEach(() => vi.unstubAllGlobals());
describe('browser UART install service', () => {
  it('stops on unplug during a sector write without retrying or committing the bank header', async () => {
    const serial = new Serial(), channel = new UartChannel(serial), bytes = bundle();
    serial.push(response(0xfffffffc));
    serial.onWrite = data => {
      if (data.length === 128) serial.push(response(0xfffffffe));
      else if (data.length === 36) serial.push(response(0));
      else serial.unplug();
    };
    try {
      await expect(streamMusic(channel, bytes, validateMusicBundle(bytes, 'puzzle-music', 2), () => {}))
        .rejects.toThrow('Adapter connection lost');
    } finally { channel.release(); }
    expect(serial.writes.map(data => data.length)).toEqual([128, 36, 4096]);
  });
  it('uses the existing Type-3 encrypted framing and ACK progress', async () => {
    const payload = new Uint8Array(65532).fill(42), prepared = await prepareDownload(payload);
    expect(prepared.records).toHaveLength(16);
    for (let i = 0; i < prepared.records.length; i++) {
      const record = prepared.records[i]!;
      const chunk = parseChunk(await tcpCrypt(record.subarray(0, 4), record.subarray(4)));
      expect(chunk).toMatchObject({ sessionId: 0, msgType: 3, chunkIndex: i });
      expect(chunk.payload).toEqual(payload.slice(i * 4096, (i + 1) * 4096));
    }
    const serial = new Serial(), channel = new UartChannel(serial);
    serial.onWrite = () => serial.line('ACK');
    const progress: number[] = [];
    try { await sendDownload(channel, prepared, done => progress.push(done)); }
    finally { channel.release(); }
    expect(progress.at(-1)).toBe(65532); expect(serial.writes).toHaveLength(17);
  });
  it('retries NAK and ENQ with identical records and rejects cancellation', async () => {
    const serial = new Serial(), channel = new UartChannel(serial), prepared = await prepareDownload(new Uint8Array(5000));
    const replies = ['ACK', 'NAK', 'ACK', 'ENQ 1', 'ACK'];
    serial.onWrite = () => serial.line(replies.shift()!);
    try { await sendDownload(channel, prepared); }
    finally { channel.release(); }
    expect(serial.writes[1]).toEqual(serial.writes[2]); expect(serial.writes[3]).toEqual(serial.writes[4]);
    const cancelled = new Serial(), c = new UartChannel(cancelled); cancelled.onWrite = () => cancelled.line('CAN');
    try { await expect(sendDownload(c, prepared)).rejects.toThrow('cancelled'); } finally { c.release(); }
  });
  it('timeout leaves partial bytes and one pending read for the current owner', async () => {
    const serial = new Serial(), old = new UartChannel(serial);
    serial.push(Uint8Array.of(1));
    await expect(old.exact(2, 5)).rejects.toThrow('stopped responding');
    serial.push(Uint8Array.of(2)); expect(await old.exact(2, 100)).toEqual(Uint8Array.of(1, 2));
    old.release();
    const reads = serial.reads, next = new UartChannel(serial);
    expect(serial.reads).toBe(reads);
    serial.push(Uint8Array.of(3)); expect(await next.exact(1, 100)).toEqual(Uint8Array.of(3)); next.release();
  });
  it('retains the readiness frame coalesced with the final Download ACK, skips exact sectors and verifies completion', async () => {
    const serial = new Serial(), channel = new UartChannel(serial), bytes = bundle();
    const records = validateMusicBundle(bytes, 'puzzle-music', 2); let stage = 0;
    serial.onWrite = data => {
      if (stage++ === 0) { serial.line('ACK'); return; }
      if (stage === 2) {
        const together = new Uint8Array(21); together.set(new TextEncoder().encode('ACK\r\n')); together.set(response(0xfffffffc), 5);
        serial.push(together); return;
      }
      if (data.length === 128) serial.push(response(0xfffffffe));
      else if (data.length === 36) {
        const seq = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
        serial.push(response(seq, seq === 0 ? 2 : 0));
      } else if (data.length === 4096) {
        const both = new Uint8Array(32); both.set(response(1, 1)); both.set(response(0xfffffffd), 16); serial.push(both);
      }
    };
    try {
      await sendDownload(channel, await prepareDownload(new Uint8Array(8)));
      expect(await streamMusic(channel, bytes, records, () => {})).toMatchObject({ completed: 2, written: 1, matched: 1 });
    } finally { channel.release(); }
    expect(serial.writes.filter(b => b.length === 4096)).toHaveLength(1);
  });
  it('stops before music writes on an occupied bank and rejects corrupt or protected sector records', async () => {
    const serial = new Serial(), channel = new UartChannel(serial), bytes = bundle();
    serial.push(response(0xfffffffc, 3, 3));
    try { await expect(streamMusic(channel, bytes, validateMusicBundle(bytes, 'puzzle-music', 2), () => {})).rejects.toThrow('Nothing was erased'); }
    finally { channel.release(); }
    expect(serial.writes).toHaveLength(0);
    bytes[128 + 36] ^= 1; expect(() => validateMusicBundle(bytes, 'puzzle-music', 2)).toThrow('sector');
    const other = bundle(), v = new DataView(other.buffer); v.setUint32(128 + 8, 0xefe000, true);
    v.setUint32(128 + 32, crc32(other.subarray(128, 160)), true);
    expect(() => validateMusicBundle(other, 'puzzle-music', 2)).toThrow('sector');
  });
  it('rejects an artifact hash mismatch before opening a UART transaction', async () => {
    const serial = new Serial();
    const service = new GameInstallService(new URL('https://example.test/games/'), vi.fn(async () => new Response(new Uint8Array(4))) as typeof fetch);
    await expect(service.sendGame(serial, { file: 'test.bin', sha256: '0'.repeat(64), bytes: 4 }, () => {})).rejects.toThrow('verification failed');
    expect(serial.writes).toHaveLength(0); expect(serial.reads).toBe(0);
  });
  it('hands the pending serial read to the game bridge without opening another reader', async () => {
    class Socket extends EventTarget { static OPEN = 1; readyState = 1; sent: Uint8Array[] = []; send(b: Uint8Array) { this.sent.push(b); } }
    vi.stubGlobal('WebSocket', Socket);
    const serial = new Serial(), channel = new UartChannel(serial);
    channel.release(); const before = serial.reads;
    const socket = new Socket(), bridge = new SerialBridge(serial, socket as unknown as WebSocket);
    bridge.start(); expect(serial.reads).toBe(before);
    serial.push(Uint8Array.of(7, 8, 9)); await new Promise(r => setTimeout(r, 20));
    expect(socket.sent).toEqual([Uint8Array.of(7, 8, 9)]); bridge.stop();
  });
});
