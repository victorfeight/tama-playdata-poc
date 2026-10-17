import { createChunk } from "./framing";
import { tcpCrypt } from "./tcp-crypto";
import { UartChannel, UartTimeout } from "./uart-channel";

export interface PreparedDownload { bytes: number; records: Uint8Array[] }

/** Existing Type-3 codec, tama-tools retry/ENQ policy, Suite/SDK PKT entry.
 * Keep prepared ciphertext identical on retries, with a deadline per response.
 */
export async function prepareDownload(data: Uint8Array): Promise<PreparedDownload> {
  if (data.length < 1 || data.length > 65536) throw new Error("A Download payload must contain 1–65,536 bytes.");
  const records: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += 4096) {
    const nonce = crypto.getRandomValues(new Uint8Array(4));
    const encrypted = await tcpCrypt(nonce, createChunk(0, 3, records.length, data.subarray(offset, offset + 4096)));
    const record = new Uint8Array(encrypted.length + 4); record.set(nonce); record.set(encrypted, 4); records.push(record);
  }
  return { bytes: data.length, records };
}

export async function sendDownload(channel: UartChannel, download: PreparedDownload,
  progress: (done: number, total: number) => void = () => {}, timeoutMs = 10_000): Promise<void> {
  const response = async (): Promise<string> => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const line = await channel.lineReply(deadline - performance.now());
      if (line === "ECHO REQ") { await channel.line("ECHO REP"); continue; }
      if (line === "CAN") throw new Error("Paradise cancelled the Download. Reopen Connection → Download → Download to retry.");
      if (/^(ACK|NAK|ENQ \d+)$/.test(line)) return line;
    }
    throw new UartTimeout();
  };
  channel.clear();
  let accepted = false;
  for (let attempt = 0; attempt < 3 && !accepted; attempt++) {
    await channel.line(`PKT ${download.bytes}`);
    try { accepted = await response() === "ACK"; }
    catch (error) { if (!(error instanceof UartTimeout)) throw error; }
  }
  if (!accepted) throw new Error("Open Connection → Download → Download on your toy, then try sending again.");
  let index = 0, attempts = 0, transmissions = 0;
  progress(0, download.bytes);
  while (index < download.records.length) {
    if (++transmissions > 100 || ++attempts > 3) throw new Error("Download retry limit reached. Reopen Download on your toy and retry.");
    await channel.write(download.records[index]!);
    let reply: string;
    try { reply = await response(); }
    catch (error) { if (error instanceof UartTimeout) continue; throw error; }
    if (reply === "ACK") { index++; attempts = 0; }
    else if (reply.startsWith("ENQ ")) {
      const requested = Number(reply.slice(4));
      if (!Number.isInteger(requested) || requested < 0 || requested >= download.records.length) throw new Error("Invalid Download retry request.");
      index = requested; attempts = 0;
    }
    progress(Math.min(index * 4096, download.bytes), download.bytes);
  }
}
