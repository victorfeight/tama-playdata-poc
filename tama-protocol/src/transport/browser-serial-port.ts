export interface SerialStreamPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

export interface BrowserSerialOpenOptions {
  baudRate: number;
  dataBits: 8;
  stopBits: 1;
  parity: "none";
  flowControl: "none";
}

export interface BrowserSerialPort extends SerialStreamPort {
  open(options: BrowserSerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
