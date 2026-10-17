import { subscribeSerial } from "./serial-reader";
import type { Transport } from "@tama-breed-poc/tama-protocol";
import { SerialBatcher } from "./serial-batcher";

export interface BridgeStats {
  bytesIn: number;
  bytesOut: number;
}

export interface SerialBridgeEvents {
  bytes?(direction: "in" | "out", data: Uint8Array, stats: BridgeStats): void;
  error?(error: unknown): void;
}

export class SerialBridge {
  private closed = false;
  private unsubscribeSerial: (() => void) | undefined;
  private messageHandler: ((event: MessageEvent) => void) | undefined;
  private readonly serialBatcher: SerialBatcher;
  readonly stats: BridgeStats = { bytesIn: 0, bytesOut: 0 };

  /** True once the bridge has been stopped, closed, or its serial pump
   *  exited on error. A dead bridge knows it's dead. */
  get isClosed(): boolean {
    return this.closed;
  }

  constructor(
    private readonly serial: Transport,
    private readonly ws: WebSocket,
    private readonly events: SerialBridgeEvents = {}
  ) {
    this.ws.binaryType = "arraybuffer";
    this.serialBatcher = new SerialBatcher((data) => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(data);
      this.stats.bytesOut += data.length;
      this.events.bytes?.("out", data, this.stats);
    });
  }

  start(): void {
    if (this.closed || this.messageHandler) return;
    this.unsubscribeSerial = subscribeSerial(this.serial, {
      bytes: (data) => {
        if (this.ws.readyState === WebSocket.OPEN) this.serialBatcher.push(data);
      },
      error: (error) => {
        this.stop();
        this.events.error?.(error);
      }
    });
    this.messageHandler = (event) => {
      void this.writePeerBytes(event);
    };
    this.ws.addEventListener("message", this.messageHandler);
  }

  stop(): void {
    this.closed = true;
    this.unsubscribeSerial?.();
    this.unsubscribeSerial = undefined;
    this.serialBatcher.discard();
    if (this.messageHandler) {
      this.ws.removeEventListener("message", this.messageHandler);
      this.messageHandler = undefined;
    }
  }

  async close(): Promise<void> {
    this.stop();
    this.ws.close();
    await this.serial.close();
  }

  private async writePeerBytes(event: MessageEvent): Promise<void> {
    if (this.closed) return;
    try {
      if (typeof event.data === "string") return;
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array(await event.data.arrayBuffer());
      if (this.closed) return;
      await this.serial.write(data);
      this.stats.bytesIn += data.length;
      this.events.bytes?.("in", data, this.stats);
    } catch (error) {
      if (!this.closed) this.events.error?.(error);
    }
  }
}
