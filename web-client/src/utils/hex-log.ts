export class HexLog {
  private lines: string[] = [];

  constructor(private readonly limit = 120) {}

  push(direction: "in" | "out", data: Uint8Array): void {
    this.lines.push(...formatLines(direction, data));
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
  }

  toString(): string {
    return this.lines.join("\n");
  }
}

const asciiDecoder = new TextDecoder("ascii");

function formatLines(direction: "in" | "out", data: Uint8Array): string[] {
  const arrow = direction === "in" ? "<-" : "->";
  const label = direction === "in" ? "peer" : "device";
  const ascii = decodeAsciiLine(data);

  if (ascii) {
    return splitAsciiLines(ascii).map((line) => `${arrow} ${label}: ${classifyCommand(line)}`);
  }

  if (data.length >= 12) {
    return [`${arrow} ${label}: encrypted chunk ${data.length} bytes (${briefHex(data, 8)})`];
  }

  return [`${arrow} ${label}: ${briefHex(data, 16)}`];
}

function decodeAsciiLine(data: Uint8Array): string | undefined {
  if (!data.length || data.length > 180) return undefined;
  for (const byte of data) {
    const printable = byte === 0x09 || byte === 0x0d || byte === 0x0a || (byte >= 0x20 && byte <= 0x7e);
    if (!printable) return undefined;
  }
  const text = asciiDecoder.decode(data).trim();
  return text || undefined;
}

function splitAsciiLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function classifyCommand(line: string): string {
  const pkt = /^PKT\s+(\d+)$/i.exec(line);
  if (pkt) return `packet start, ${Number(pkt[1]).toLocaleString()} bytes`;

  if (line === "ACK") return "ACK";
  if (line === "NAK") return "NAK retry";
  if (line === "CAN") return "cancel";
  if (line === "ECHO REQ") return "echo request";
  if (line === "ECHO REP") return "echo reply";
  if (line === "BREED 1") return "breeding accepted";
  if (line === "SYNC 1") return "breeding sync 1";
  if (line === "SYNC 2") return "breeding sync 2";
  if (/not\s*found/i.test(line) || /^notfound/i.test(line)) return `text: ${line}`;
  if (/error/i.test(line)) return `error text: ${line}`;

  return `text: ${line}`;
}

function briefHex(data: Uint8Array, maxBytes: number): string {
  const shown = [...data.slice(0, maxBytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return data.length > maxBytes ? `${shown} ...` : shown;
}
