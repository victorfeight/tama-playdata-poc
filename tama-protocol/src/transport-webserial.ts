import { DEFAULT_SERIAL_OPTIONS, SerialOpenOptions, Transport, withTimeout } from "./transport";
import type { BrowserSerialPort } from "./transport/browser-serial-port";
import { requestWebUsbSerialPort } from "./transport/webusb-serial";
import type { UsbDeviceFilterLike, UsbDeviceLike } from "./transport/webusb-types";

// Per the W3C WebSerial spec, SerialPort.getInfo() returns only
// { usbVendorId, usbProductId } -- no friendly name by design (privacy).
// We surface the VID:PID hex pair and leave chip identification to the user.
type SerialPortInfo = { usbVendorId?: number; usbProductId?: number };

type SerialPortLike = BrowserSerialPort;

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

  constructor(private readonly _port: SerialPortLike) {}

  /** Underlying SerialPort handle — exposed so callers can match against
   *  navigator.serial 'disconnect' events. */
  get port(): SerialPortLike {
    return this._port;
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get info(): PortInfo {
    return describePort(this._port.getInfo?.() ?? {});
  }

  async open(options: SerialOpenOptions = {}): Promise<void> {
    if (this.openState) return;
    const baudRate = options.baudRate ?? DEFAULT_SERIAL_OPTIONS.baudRate;
    await this._port.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none"
    });
    if (!this._port.readable || !this._port.writable) throw new Error("serial port missing streams after open");
    this.reader = this._port.readable.getReader();
    this.writer = this._port.writable.getWriter();
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
      await this._port.close();
    } catch {
      // The browser reports this when the port has already been released.
    }
  }
}

export async function requestParadiseSerialPort(): Promise<WebSerialTransport> {
  // Android Chrome exposes supported wired adapters through WebUSB. On desktop,
  // prefer the operating system's serial driver and use WebUSB as a fallback.
  let port: SerialPortLike;
  if (/Android/i.test(navigator.userAgent) && navigator.usb) {
    port = await requestWebUsbSerialPort(navigator.usb);
  } else if (navigator.serial) {
    port = await navigator.serial.requestPort() as SerialPortLike;
  } else if (navigator.usb) {
    port = await requestWebUsbSerialPort(navigator.usb);
  } else {
    throw new Error("This browser does not provide WebSerial or WebUSB.");
  }
  return new WebSerialTransport(port);
}

export function hasParadiseSerial(): boolean {
  return Boolean(navigator.serial || navigator.usb);
}

declare global {
  interface Navigator {
    serial?: {
      requestPort(): Promise<unknown>;
      getPorts(): Promise<unknown[]>;
      addEventListener(type: "connect" | "disconnect", listener: (event: Event & { target: SerialPortLike }) => void): void;
      removeEventListener(type: "connect" | "disconnect", listener: (event: Event & { target: SerialPortLike }) => void): void;
    };
    usb?: {
      requestDevice(options: { filters: ReadonlyArray<UsbDeviceFilterLike> }): Promise<UsbDeviceLike>;
      getDevices(): Promise<unknown[]>;
      addEventListener(type: "connect" | "disconnect", listener: (event: Event & { device: UsbDeviceLike }) => void): void;
      removeEventListener(type: "connect" | "disconnect", listener: (event: Event & { device: UsbDeviceLike }) => void): void;
    };
  }
}
