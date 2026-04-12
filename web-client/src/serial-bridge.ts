import { Transport } from "@tama-breed-poc/tama-protocol";

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
  private messageHandler: ((event: MessageEvent) => void) | undefined;
  readonly stats: BridgeStats = { bytesIn: 0, bytesOut: 0 };

  constructor(
    private readonly serial: Transport,
    private readonly ws: WebSocket,
    private readonly events: SerialBridgeEvents = {}
  ) {
    this.ws.binaryType = "arraybuffer";
  }

  start(): void {
    if (this.messageHandler) return;
    this.messageHandler = (event) => {
      void this.writePeerBytes(event);
    };
    this.ws.addEventListener("message", this.messageHandler);
    void this.pumpSerialToSocket();
  }

  stop(): void {
    this.closed = true;
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
      await this.serial.write(data);
      this.stats.bytesIn += data.length;
      this.events.bytes?.("in", data, this.stats);
    } catch (error) {
      this.events.error?.(error);
    }
  }

  private async pumpSerialToSocket(): Promise<void> {
    while (!this.closed) {
      try {
        const data = await this.serial.read();
        if (this.closed || !data.length) continue;
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(data);
          this.stats.bytesOut += data.length;
          this.events.bytes?.("out", data, this.stats);
        }
      } catch (error) {
        if (!this.closed) this.events.error?.(error);
        return;
      }
    }
  }
}
