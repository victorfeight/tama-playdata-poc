import type { Transport } from "./transport.js";
import { subscribeSerial } from "./serial-reader";

export class UartTimeout extends Error {
  constructor() { super("The toy stopped responding. Check its screen and connection before retrying."); }
}

export class UartConnectionError extends Error {
  constructor(cause: unknown) {
    super("Adapter connection lost. Reconnect it and check the toy’s screen before trying again.", { cause });
  }
}

/** Buffered transactions over the same single reader used by the relay bridge.
 * Adapted from tama-tools/transport/uart-channel: a timed-out read never steals
 * the next reply. release() relinquishes ownership without closing the port.
 */
export class UartChannel {
  private queue: number[] = [];
  private wake: (() => void) | undefined;
  private failure: Error | undefined;
  private reading = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly transport: Transport) {
    this.unsubscribe = subscribeSerial(transport, {
      bytes: bytes => {
        if (this.queue.length + bytes.length > 131072) this.failure = new Error("UART receive buffer overflow.");
        else for (const byte of bytes) this.queue.push(byte);
        this.wake?.();
      },
      error: error => { this.failure = new UartConnectionError(error); this.wake?.(); }
    });
  }
  clear(): void { this.queue = []; }
  async write(bytes: Uint8Array): Promise<void> {
    if (this.failure) throw this.failure;
    try { await this.transport.write(bytes); }
    catch (error) { this.failure = new UartConnectionError(error); this.wake?.(); throw this.failure; }
  }
  line(text: string): Promise<void> { return this.write(new TextEncoder().encode(text + "\r\n")); }
  exact(length: number, timeout: number): Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 1 || length > 131072) throw new Error("Invalid UART read length.");
    return this.read(() => this.queue.length >= length ? length : -1, timeout);
  }
  async lineReply(timeout: number): Promise<string> {
    const bytes = await this.read(() => {
      const end = this.queue.indexOf(10);
      if (end > 256 || (end < 0 && this.queue.length > 256)) throw new Error("Invalid UART line response.");
      return end < 0 ? -1 : end + 1;
    }, timeout);
    return new TextDecoder().decode(bytes).trim();
  }
  release(): void {
    this.failure = new Error("UART transaction ended.");
    this.unsubscribe(); this.queue = []; this.wake?.();
  }
  private async read(available: () => number, timeout: number): Promise<Uint8Array> {
    if (this.reading) throw new Error("Another UART transaction is reading.");
    this.reading = true;
    const deadline = performance.now() + timeout;
    try {
      for (;;) {
        if (this.failure) throw this.failure;
        if (performance.now() > deadline) throw new UartTimeout();
        const length = available();
        if (length >= 0) return Uint8Array.from(this.queue.splice(0, length));
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new UartTimeout();
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
          const timer = setTimeout(done, remaining); this.wake = done;
        });
      }
    } finally { this.reading = false; }
  }
}
