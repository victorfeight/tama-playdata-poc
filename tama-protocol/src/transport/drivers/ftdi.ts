import type { WebUsbSerialDriver } from "../webusb-driver.js";
import { firstBulkLayout } from "../webusb-types.js";

const VENDOR_ID = 0x0403;
const PRODUCT_IDS = new Set([0x6001, 0x6010, 0x6011, 0x6014, 0x6015]);

export interface FtdiBaudRegisters {
  value: number;
  fractionalIndex: number;
}

export function calculateFtdiBaudRegisters(baudRate: number): FtdiBaudRegisters {
  if (!Number.isInteger(baudRate) || baudRate <= 0 || baudRate > 3_500_000) {
    throw new Error(`Unsupported FTDI baud rate: ${baudRate}`);
  }

  let divisor: number;
  let subDivisor: number;
  let effectiveBaudRate: number;
  if (baudRate >= 2_500_000) {
    divisor = 0;
    subDivisor = 0;
    effectiveBaudRate = 3_000_000;
  } else if (baudRate >= 1_750_000) {
    divisor = 1;
    subDivisor = 0;
    effectiveBaudRate = 2_000_000;
  } else {
    let encoded = Math.floor(48_000_000 / baudRate);
    encoded = (encoded + 1) >> 1;
    subDivisor = encoded & 0x07;
    divisor = encoded >> 3;
    if (divisor > 0x3fff) throw new Error(`Unsupported FTDI baud rate: ${baudRate}`);
    effectiveBaudRate = Math.floor(48_000_000 / ((divisor << 3) + subDivisor));
    effectiveBaudRate = (effectiveBaudRate + 1) >> 1;
  }
  if (Math.abs(1 - effectiveBaudRate / baudRate) >= 0.031) {
    throw new Error(`FTDI cannot represent baud rate ${baudRate} accurately`);
  }

  let value = divisor;
  let fractionalIndex = 0;
  switch (subDivisor) {
    case 0: break;
    case 4: value |= 0x4000; break;
    case 2: value |= 0x8000; break;
    case 1: value |= 0xc000; break;
    case 3: fractionalIndex = 1; break;
    case 5: value |= 0x4000; fractionalIndex = 1; break;
    case 6: value |= 0x8000; fractionalIndex = 1; break;
    case 7: value |= 0xc000; fractionalIndex = 1; break;
  }
  return { value, fractionalIndex };
}

export function stripFtdiStatusBytes(data: Uint8Array, packetSize: number): Uint8Array {
  if (data.length < 2) return new Uint8Array();
  const payload: number[] = [];
  for (let offset = 0; offset < data.length; offset += packetSize) {
    const end = Math.min(offset + packetSize, data.length);
    for (let index = Math.min(offset + 2, end); index < end; index += 1) {
      payload.push(data[index] ?? 0);
    }
  }
  return Uint8Array.from(payload);
}

export const ftdiDriver: WebUsbSerialDriver = {
  name: "FTDI",
  filters: [...PRODUCT_IDS].map((productId) => ({ vendorId: VENDOR_ID, productId })),
  supports: (device) =>
    device.vendorId === VENDOR_ID && PRODUCT_IDS.has(device.productId),
  layout: firstBulkLayout,
  initialize: async (context, options) => {
    const port = context.layout.controlInterface + 1;
    const out = (request: number, value: number, index = port) =>
      context.controlOut("vendor", "device", request, value, index);

    await out(0x00, 0x0000); // Reset SIO.
    await out(0x01, 0x0300); // Initialize DTR + RTS deasserted.
    await out(0x02, 0x0000); // Disable hardware/software flow control.
    const baud = calculateFtdiBaudRegisters(options.baudRate);
    const version = context.device.deviceVersionMajor ?? 0;
    const baudUsesPort = [7, 8, 9].includes(version) ||
      context.device.configuration!.interfaces.length > 1;
    const baudIndex = baudUsesPort
      ? (baud.fractionalIndex << 8) | port
      : baud.fractionalIndex;
    await out(0x03, baud.value, baudIndex);
    await out(0x04, 0x0008); // 8N1.
    await out(0x09, 6); // ~5.5 ms at 460800; avoids long short-packet stalls.
    await out(0x01, 0x0101); // Assert DTR.
    await out(0x01, 0x0202); // Assert RTS without altering DTR.
  },
  shutdown: async (context) => {
    const port = context.layout.controlInterface + 1;
    await context.controlOut("vendor", "device", 0x00, 0x0001, port);
    await context.controlOut("vendor", "device", 0x00, 0x0002, port);
  },
  transformInput: stripFtdiStatusBytes,
};
