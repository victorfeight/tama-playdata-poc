import { Transport } from "./transport";

export class WebSocketTransport implements Transport {
  readonly name = "websocket";
  private queue: Uint8Array[] = [];
  private waiters: Array<(value: Uint8Array) => void> = [];

  constructor(private readonly socket: WebSocket) {
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("message", (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array(event.data);
      const waiter = this.waiters.shift();
      if (waiter) waiter(data);
      else this.queue.push(data);
    });
  }

  async read(): Promise<Uint8Array> {
    const next = this.queue.shift();
    if (next) return next;
    return new Promise<Uint8Array>((resolve) => this.waiters.push(resolve));
  }

  async write(data: Uint8Array): Promise<void> {
    this.socket.send(data);
  }

  async close(): Promise<void> {
    this.socket.close();
  }
}
