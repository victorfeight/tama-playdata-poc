import { test, vi } from "vitest";
import { requestParadiseSerialPort } from "../src/transport-webserial.js";
import { cdcAcmDriver } from "../src/transport/drivers/cdc-acm.js";
import {
  calculateCh34xBaudRegisters,
  ch34xDriver,
} from "../src/transport/drivers/ch34x.js";
import { cp210xDriver } from "../src/transport/drivers/cp210x.js";
import {
  calculateFtdiBaudRegisters,
  ftdiDriver,
  stripFtdiStatusBytes,
} from "../src/transport/drivers/ftdi.js";
import { prolificDriver } from "../src/transport/drivers/prolific.js";
import { WebUsbSerialPort } from "../src/transport/webusb-port.js";
import {
  findWebUsbDriver,
  WEBUSB_SERIAL_FILTERS,
} from "../src/transport/webusb-serial.js";
import type {
  UsbConfigurationLike,
  UsbControlTransferParameters,
  UsbDeviceLike,
} from "../src/transport/webusb-types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function dataView(bytes: ArrayLike<number>): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

const BULK_CONFIGURATION: UsbConfigurationLike = {
  configurationValue: 1,
  interfaces: [{
    interfaceNumber: 0,
    alternates: [{
      alternateSetting: 0,
      endpoints: [
        { endpointNumber: 1, direction: "in", type: "bulk", packetSize: 64 },
        { endpointNumber: 2, direction: "out", type: "bulk", packetSize: 64 },
      ],
    }],
  }],
};

const CDC_CONFIGURATION: UsbConfigurationLike = {
  configurationValue: 1,
  interfaces: [
    {
      interfaceNumber: 0,
      alternates: [{
        alternateSetting: 0,
        interfaceClass: 0x02,
        endpoints: [],
      }],
    },
    {
      interfaceNumber: 1,
      alternates: [{
        alternateSetting: 0,
        interfaceClass: 0x0a,
        endpoints: [
          { endpointNumber: 3, direction: "in", type: "bulk", packetSize: 512 },
          { endpointNumber: 4, direction: "out", type: "bulk", packetSize: 512 },
        ],
      }],
    },
  ],
};

class FakeUsbDevice implements UsbDeviceLike {
  configuration: UsbConfigurationLike | null = null;
  readonly configurations: readonly UsbConfigurationLike[];
  readonly controlWrites: Array<{
    setup: UsbControlTransferParameters;
    data: Uint8Array;
  }> = [];
  readonly controlReads: UsbControlTransferParameters[] = [];
  readonly bulkWrites: Uint8Array[] = [];
  readonly calls: string[] = [];
  nextRead = Uint8Array.from([0x50, 0x4b, 0x54, 0x0d, 0x0a]);

  constructor(
    readonly vendorId: number,
    readonly productId: number,
    configuration: UsbConfigurationLike,
    readonly deviceVersionMajor = 6,
    readonly deviceClass = 0,
    readonly usbVersionMajor = 1,
  ) {
    this.configurations = [configuration];
  }

  async open(): Promise<void> { this.calls.push("open"); }
  async close(): Promise<void> { this.calls.push("close"); }
  async selectConfiguration(value: number): Promise<void> {
    equal(value, 1, "configuration");
    this.configuration = this.configurations[0] ?? null;
  }
  async claimInterface(value: number): Promise<void> {
    this.calls.push(`claim:${value}`);
  }
  async releaseInterface(value: number): Promise<void> {
    this.calls.push(`release:${value}`);
  }
  async selectAlternateInterface(): Promise<void> {
    throw new Error("default alternate should not be selected explicitly");
  }
  async controlTransferIn(
    setup: UsbControlTransferParameters,
    length: number,
  ): Promise<{ status: string; data: DataView }> {
    this.controlReads.push(setup);
    const bytes = new Uint8Array(length);
    if (setup.request === 0x5f && length >= 1) bytes[0] = 0x30;
    return {
      status: "ok",
      data: dataView(bytes),
    };
  }
  async controlTransferOut(
    setup: UsbControlTransferParameters,
    data?: BufferSource,
  ): Promise<{ status: string; bytesWritten?: number }> {
    let bytes = new Uint8Array();
    if (data && ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    }
    this.controlWrites.push({ setup, data: bytes });
    return { status: "ok", bytesWritten: data ? bytes.length : undefined };
  }
  async transferIn(endpointNumber: number): Promise<{ status: string; data: DataView }> {
    assert(endpointNumber > 0, "input endpoint must be resolved");
    const bytes = this.nextRead;
    this.nextRead = new Uint8Array();
    return { status: "ok", data: dataView(bytes) };
  }
  async transferOut(
    endpointNumber: number,
    data: BufferSource,
  ): Promise<{ status: string; bytesWritten: number }> {
    assert(endpointNumber > 0, "output endpoint must be resolved");
    assert(ArrayBuffer.isView(data), "bulk output should be an ArrayBuffer view");
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    this.bulkWrites.push(bytes);
    return { status: "ok", bytesWritten: bytes.length };
  }
}

const OPEN_OPTIONS = {
  baudRate: 460800,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: "none" as const,
  flowControl: "none" as const,
};

function hasControlWrite(
  device: FakeUsbDevice,
  request: number,
  value: number,
  index?: number,
): boolean {
  return device.controlWrites.some((write) =>
    write.setup.request === request && write.setup.value === value &&
    (index === undefined || write.setup.index === index)
  );
}

async function exerciseStreams(port: WebUsbSerialPort, device: FakeUsbDevice): Promise<void> {
  assert(port.readable && port.writable, "open should expose both streams");
  const reader = port.readable.getReader();
  const read = await reader.read();
  equal(new TextDecoder().decode(read.value), "PKT\r\n", "bulk input");
  await reader.cancel();
  reader.releaseLock();
  const writer = port.writable.getWriter();
  await writer.write(Uint8Array.from([1, 2, 3]));
  writer.releaseLock();
  equal(device.bulkWrites[0]?.join(","), "1,2,3", "bulk output");
  await port.close();
}

async function testCh34x(): Promise<void> {
  const baud = calculateCh34xBaudRegisters(460800);
  equal(baud.factor, 0xf383, "CH34x 460800 factor");
  equal(baud.divisor, 0x0002, "CH34x 460800 divisor");
  const device = new FakeUsbDevice(0x1a86, 0x7523, BULK_CONFIGURATION);
  const port = new WebUsbSerialPort(device, ch34xDriver);
  await port.open(OPEN_OPTIONS);
  assert(hasControlWrite(device, 0x9a, 0x1312, 0xf383), "CH34x baud setup");
  assert(hasControlWrite(device, 0xa4, 0xff9f), "CH34x DTR/RTS setup");
  await exerciseStreams(port, device);
}

async function testCp210x(): Promise<void> {
  const device = new FakeUsbDevice(0x10c4, 0xea60, BULK_CONFIGURATION);
  const port = new WebUsbSerialPort(device, cp210xDriver);
  await port.open(OPEN_OPTIONS);
  assert(hasControlWrite(device, 0x00, 1), "CP210x UART enable");
  assert(hasControlWrite(device, 0x07, 0x0101), "CP210x DTR setup");
  assert(hasControlWrite(device, 0x07, 0x0202), "CP210x RTS setup");
  const baud = device.controlWrites.find((write) => write.setup.request === 0x1e);
  equal(baud?.data.join(","), "0,8,7,0", "CP210x 460800 payload");
  await exerciseStreams(port, device);
  assert(hasControlWrite(device, 0x00, 0), "CP210x UART disable");
}

async function testFtdi(): Promise<void> {
  const baud = calculateFtdiBaudRegisters(460800);
  equal(baud.value, 0x4006, "FTDI 460800 divisor");
  equal(baud.fractionalIndex, 0, "FTDI 460800 fractional index");
  equal(
    stripFtdiStatusBytes(Uint8Array.from([1, 2, 10, 11, 3, 4, 12]), 4).join(","),
    "10,11,12",
    "FTDI packet status filtering",
  );
  const device = new FakeUsbDevice(0x0403, 0x6001, BULK_CONFIGURATION);
  device.nextRead = Uint8Array.from([0x01, 0x60, 0x50, 0x4b, 0x54, 0x0d, 0x0a]);
  const port = new WebUsbSerialPort(device, ftdiDriver);
  await port.open(OPEN_OPTIONS);
  assert(hasControlWrite(device, 0x03, 0x4006, 0), "FTDI baud setup");
  await exerciseStreams(port, device);
}

async function testCdcAcm(): Promise<void> {
  const device = new FakeUsbDevice(0x1a86, 0x55db, CDC_CONFIGURATION);
  const port = new WebUsbSerialPort(device, cdcAcmDriver);
  await port.open(OPEN_OPTIONS);
  const lineCoding = device.controlWrites.find((write) => write.setup.request === 0x20);
  equal(lineCoding?.data.join(","), "0,8,7,0,0,0,8", "CDC 460800 8N1 line coding");
  assert(hasControlWrite(device, 0x22, 3, 0), "CDC DTR/RTS setup");
  await exerciseStreams(port, device);
  assert(hasControlWrite(device, 0x22, 0, 0), "CDC line shutdown");
}

async function testProlific(): Promise<void> {
  const device = new FakeUsbDevice(0x067b, 0x2303, BULK_CONFIGURATION);
  const port = new WebUsbSerialPort(device, prolificDriver);
  await port.open(OPEN_OPTIONS);
  const lineCoding = device.controlWrites.find((write) => write.setup.request === 0x20);
  equal(lineCoding?.data.join(","), "0,8,7,0,0,0,8", "PL2303 460800 8N1 line coding");
  assert(hasControlWrite(device, 0x22, 3, 0), "PL2303 DTR/RTS setup");
  await exerciseStreams(port, device);
}

async function testProlificHxn(): Promise<void> {
  const device = new FakeUsbDevice(
    0x067b, 0x23a3, BULK_CONFIGURATION, 6, 0, 2,
  );
  const port = new WebUsbSerialPort(device, prolificDriver);
  await port.open(OPEN_OPTIONS);
  assert(device.controlWrites.some((write) =>
    write.setup.request === 0x80 &&
    write.setup.value === 0x07 &&
    write.setup.index === 0x03
  ), "PL2303 HXN pipe reset");
  assert(device.controlReads.every((read) => read.value !== 0x8484),
    "PL2303 HXN must skip the legacy initialization exchange");
  await exerciseStreams(port, device);
}

function testRegistry(): void {
  equal(
    findWebUsbDriver(new FakeUsbDevice(0x1a86, 0x7523, BULK_CONFIGURATION))?.name,
    "CH340/CH341",
    "CH340 registry",
  );
  equal(
    findWebUsbDriver(new FakeUsbDevice(0x10c4, 0xea60, BULK_CONFIGURATION))?.name,
    "CP210x",
    "CP210x registry",
  );
  equal(
    findWebUsbDriver(new FakeUsbDevice(0x0403, 0x6001, BULK_CONFIGURATION))?.name,
    "FTDI",
    "FTDI registry",
  );
  equal(
    findWebUsbDriver(new FakeUsbDevice(0x067b, 0x2303, BULK_CONFIGURATION))?.name,
    "PL2303",
    "Prolific registry",
  );
  equal(
    findWebUsbDriver(new FakeUsbDevice(0x1a86, 0x55db, CDC_CONFIGURATION))?.name,
    "CDC-ACM",
    "CH347 CDC registry",
  );
  assert(WEBUSB_SERIAL_FILTERS.some((filter) => filter.classCode === 0x02),
    "registry should offer standards-compliant CDC adapters");
}

test("WebUSB adapter drivers and registry", async () => {
  await testCh34x();
  await testCp210x();
  await testFtdi();
  await testCdcAcm();
  await testProlific();
  await testProlificHxn();
  testRegistry();
});

test("Android chooses WebUSB while desktop keeps WebSerial", async () => {
  const device = new FakeUsbDevice(0x1a86, 0x7523, BULK_CONFIGURATION);
  const usb = { requestDevice: vi.fn(async () => device) };
  const webSerialPort = { getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) };
  const serial = { requestPort: vi.fn(async () => webSerialPort) };
  try {
    vi.stubGlobal("navigator", { userAgent: "Android", usb, serial });
    const android = await requestParadiseSerialPort();
    assert(android.port instanceof WebUsbSerialPort, "Android should use WebUSB");
    equal(serial.requestPort.mock.calls.length, 0, "Android must not request WebSerial");

    vi.stubGlobal("navigator", { userAgent: "Desktop", usb, serial });
    const desktop = await requestParadiseSerialPort();
    equal(desktop.port, webSerialPort as typeof desktop.port, "desktop should use WebSerial");
    equal(usb.requestDevice.mock.calls.length, 1, "desktop must not request WebUSB");
  } finally {
    vi.unstubAllGlobals();
  }
});
