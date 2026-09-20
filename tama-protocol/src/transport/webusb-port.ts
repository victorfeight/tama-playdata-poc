import type {
  BrowserSerialOpenOptions,
  BrowserSerialPort,
} from "./browser-serial-port.js";
import type { WebUsbSerialDriver } from "./webusb-driver.js";
import { WebUsbDriverContext } from "./webusb-driver.js";
import { copyForUsb, type UsbDeviceLike } from "./webusb-types.js";

export class WebUsbSerialPort implements BrowserSerialPort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;

  private context: WebUsbDriverContext | null = null;
  private claimedInterfaces: number[] = [];
  private opened = false;
  private closing = false;

  constructor(
    private readonly device: UsbDeviceLike,
    private readonly driver: WebUsbSerialDriver,
  ) {}

  get usbDevice(): UsbDeviceLike {
    return this.device;
  }

  getInfo(): { usbVendorId: number; usbProductId: number } {
    return {
      usbVendorId: this.device.vendorId,
      usbProductId: this.device.productId,
    };
  }

  async open(options: BrowserSerialOpenOptions): Promise<void> {
    if (this.opened) throw new Error("USB serial port is already open");
    if (options.dataBits !== 8 || options.stopBits !== 1 || options.parity !== "none") {
      throw new Error("The browser USB transport currently supports 8N1 only");
    }

    this.closing = false;
    try {
      await this.device.open();
      if (!this.device.configuration) {
        const configuration = this.device.configurations[0];
        if (!configuration) throw new Error("USB adapter has no configuration");
        await this.device.selectConfiguration(configuration.configurationValue);
      }
      const configuration = this.device.configuration;
      if (!configuration) throw new Error("USB adapter configuration is unavailable");

      const layout = this.driver.layout(configuration);
      for (const interfaceNumber of [...new Set(layout.claimedInterfaces)]) {
        await this.device.claimInterface(interfaceNumber);
        this.claimedInterfaces.push(interfaceNumber);
      }
      for (const alternate of layout.interfaceAlternates ?? []) {
        if (alternate.alternateSetting !== 0) {
          await this.device.selectAlternateInterface(
            alternate.interfaceNumber,
            alternate.alternateSetting,
          );
        }
      }

      this.context = new WebUsbDriverContext(this.device, layout);
      await this.driver.initialize(this.context, options);
      this.createStreams();
      this.opened = true;
    } catch (error) {
      await this.cleanup(false);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.opened && this.claimedInterfaces.length === 0) return;
    this.closing = true;
    this.readable = null;
    this.writable = null;
    await this.cleanup(true);
  }

  private createStreams(): void {
    const context = this.context;
    if (!context) throw new Error("USB serial driver was not initialized");
    const { input, output } = context.layout;
    const inputPacketSize = Math.max(1, input.packetSize);
    const readQueueDepth = this.driver.readQueueDepth ?? 4;
    type ReadResult =
      | { result: Awaited<ReturnType<UsbDeviceLike["transferIn"]>>; error?: never }
      | { error: unknown; result?: never };
    const pendingReads: Promise<ReadResult>[] = [];
    const queueRead = () => {
      pendingReads.push(this.device.transferIn(input.endpointNumber, inputPacketSize)
        .then((result) => ({ result }), (error) => ({ error })));
    };

    this.readable = new ReadableStream<Uint8Array>(
      {
        start: () => {
          for (let i = 0; i < readQueueDepth; i++) queueRead();
        },
        pull: async (controller) => {
          if (this.closing) {
            controller.close();
            return;
          }
          try {
            const next = pendingReads.shift();
            if (!next) throw new Error("USB read queue is empty");
            const outcome = await next;
            if (this.closing) {
              controller.close();
              return;
            }
            if ("error" in outcome) throw outcome.error;
            queueRead();
            const result = outcome.result;
            if (result.status !== "ok") {
              throw new Error(`USB serial bulk read failed (${result.status})`);
            }
            if (result.data && result.data.byteLength > 0) {
              let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(
                result.data.buffer,
                result.data.byteOffset,
                result.data.byteLength,
              ).slice();
              bytes = this.driver.transformInput?.(bytes, inputPacketSize) ?? bytes;
              if (bytes.length > 0) controller.enqueue(bytes);
            }
          } catch (error) {
            if (this.closing) controller.close();
            else controller.error(error);
          }
        },
        cancel: () => { this.closing = true; },
      },
      { highWaterMark: 0 },
    );

    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        let offset = 0;
        while (offset < chunk.length) {
          const view = chunk.subarray(offset, Math.min(offset + 4096, chunk.length));
          const payload = copyForUsb(view);
          const result = await this.device.transferOut(output.endpointNumber, payload);
          if (result.status !== "ok") {
            throw new Error(`USB serial bulk write failed (${result.status})`);
          }
          const written = result.bytesWritten ?? payload.length;
          if (written <= 0 || written > payload.length) {
            throw new Error("USB serial bulk write made no progress");
          }
          offset += written;
        }
      },
    });
  }

  private async cleanup(runShutdown: boolean): Promise<void> {
    if (runShutdown && this.context && this.driver.shutdown) {
      try { await this.driver.shutdown(this.context); } catch { /* disconnected */ }
    }
    this.context = null;
    for (const interfaceNumber of this.claimedInterfaces.reverse()) {
      try { await this.device.releaseInterface(interfaceNumber); } catch { /* disconnected */ }
    }
    this.claimedInterfaces = [];
    this.opened = false;
    try { await this.device.close(); } catch { /* disconnected */ }
  }
}
