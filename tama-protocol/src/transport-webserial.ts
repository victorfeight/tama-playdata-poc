import { DEFAULT_SERIAL_OPTIONS, SerialOpenOptions, Transport, withTimeout } from "./transport";

// Per the W3C WebSerial spec, SerialPort.getInfo() returns only
// { usbVendorId, usbProductId } -- no friendly name by design (privacy).
// We surface the VID:PID hex pair and leave chip identification to the user.
type SerialPortInfo = { usbVendorId?: number; usbProductId?: number };

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; dataBits: 8; stopBits: 1; parity: "none"; flowControl: "none" }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): SerialPortInfo;
};

export interface PortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  label: string;
}

function describePort(info: SerialPortInfo): PortInfo {
  const vid = info.usbVendorId;
  const pid = info.usbProductId;
  if (vid === undefined || pid === undefined) return { label: "USB serial" };
  const hex = (n: number) => n.toString(16).padStart(4, "0");
  return { usbVendorId: vid, usbProductId: pid, label: `${hex(vid)}:${hex(pid)}` };
}

export class WebSerialTransport implements Transport {
  readonly name = "webserial";
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private openState = false;

  constructor(private readonly port: SerialPortLike) {}

  get isOpen(): boolean {
    return this.openState;
  }

  get info(): PortInfo {
    return describePort(this.port.getInfo?.() ?? {});
  }

  async open(options: SerialOpenOptions = {}): Promise<void> {
    if (this.openState) return;
    const baudRate = options.baudRate ?? DEFAULT_SERIAL_OPTIONS.baudRate;
    await this.port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none"
    });
    if (!this.port.readable || !this.port.writable) throw new Error("serial port missing streams after open");
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.openState = true;
  }

  async read(timeoutMs?: number): Promise<Uint8Array> {
    if (!this.reader) throw new Error("serial reader is not open");
    const result = await withTimeout(this.reader.read(), timeoutMs);
    if (result.done) return new Uint8Array();
    return result.value;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error("serial writer is not open");
    await this.writer.ready;
    await this.writer.write(data);
  }

  async close(): Promise<void> {
    if (!this.openState) return;
    this.openState = false;
    const reader = this.reader;
    const writer = this.writer;
    this.reader = undefined;
    this.writer = undefined;

    try {
      await reader?.cancel();
    } catch {
      // The stream may already be closed by the browser or device.
    }
    try {
      reader?.releaseLock();
    } catch {
      // Ignore stale reader locks during teardown.
    }
    try {
      writer?.releaseLock();
    } catch {
      // Ignore stale writer locks during teardown.
    }
    try {
      await this.port.close();
    } catch {
      // The browser reports this when the port has already been released.
    }
  }
}

export async function requestParadiseSerialPort(): Promise<WebSerialTransport> {
  const serial = navigator.serial;
  if (!serial) throw new Error("WebSerial is unavailable. Use Chrome or Edge over HTTPS/localhost.");
  const port = await serial.requestPort();
  return new WebSerialTransport(port as SerialPortLike);
}

declare global {
  interface Navigator {
    serial?: {
      requestPort(): Promise<unknown>;
      getPorts(): Promise<unknown[]>;
    };
  }
}
