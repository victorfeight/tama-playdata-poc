// WebSerial commonly yields short reads. Coalesce adjacent data bytes into
// fewer WebSocket frames, while sending complete ASCII control lines at once.
export class SerialBatcher {
  private pending: Uint8Array[] = [];
  private length = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly send: (bytes: Uint8Array) => void,
    private readonly maxBytes = 4096,
    private readonly maxDelayMs = 2
  ) {}

  push(bytes: Uint8Array): void {
    if (!bytes.length) return;
    if (this.length + bytes.length > this.maxBytes) this.flush();
    this.pending.push(bytes.slice());
    this.length += bytes.length;
    if (this.length >= this.maxBytes || isCompleteCommand(bytes)) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.maxDelayMs);
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.length) return;
    const joined = new Uint8Array(this.length);
    let offset = 0;
    for (const bytes of this.pending) {
      joined.set(bytes, offset);
      offset += bytes.length;
    }
    this.pending = [];
    this.length = 0;
    this.send(joined);
  }

  discard(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
    this.length = 0;
  }
}

function isCompleteCommand(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || bytes.length > 180 || bytes[bytes.length - 2] !== 13 || bytes[bytes.length - 1] !== 10) return false;
  return bytes.every((byte) => byte === 13 || byte === 10 || (byte >= 32 && byte <= 126));
}
