import type { WebUsbSerialDriver } from "../webusb-driver.js";
import { firstBulkLayout } from "../webusb-types.js";

const VENDOR_ID = 0x1a86;
const PRODUCT_IDS = new Set([0x7523, 0x5523]);

export interface BaudRegisters {
  factor: number;
  divisor: number;
}

/** CH341 baud divisor algorithm used by usb-serial-for-android. */
export function calculateCh34xBaudRegisters(baudRate: number): BaudRegisters {
  if (!Number.isInteger(baudRate) || baudRate <= 0) {
    throw new Error("Baud rate must be a positive integer");
  }

  let factor = Math.floor(1_532_620_800 / baudRate);
  let divisor = 3;
  while (factor > 0xfff0 && divisor > 0) {
    factor >>= 3;
    divisor -= 1;
  }
  if (factor > 0xfff0) throw new Error(`Unsupported CH34x baud rate: ${baudRate}`);

  factor = 0x10000 - factor;
  divisor |= 0x80; // Avoid waiting for a completely full receive buffer.
  return {
    factor: (factor & 0xff00) | divisor,
    divisor: factor & 0xff,
  };
}

export const ch34xDriver: WebUsbSerialDriver = {
  name: "CH340/CH341",
  readQueueDepth: 32,
  filters: [
    { vendorId: VENDOR_ID, productId: 0x7523 },
    { vendorId: VENDOR_ID, productId: 0x5523 },
  ],
  supports: (device) =>
    device.vendorId === VENDOR_ID && PRODUCT_IDS.has(device.productId),
  layout: firstBulkLayout,
  initialize: async (context, options) => {
    const controlOut = (request: number, value: number, index: number) =>
      context.controlOut("vendor", "device", request, value, index);
    const setBaud = async (baudRate: number) => {
      const baud = calculateCh34xBaudRegisters(baudRate);
      await controlOut(0x9a, 0x1312, baud.factor);
      await controlOut(0x9a, 0x0f2c, baud.divisor);
    };

    const version = await context.controlIn("vendor", "device", 0x5f, 0, 0, 2);
    if (version[1] !== 0) throw new Error("Unexpected CH34x version response");
    await controlOut(0xa1, 0, 0);
    await setBaud(9600);
    await context.controlIn("vendor", "device", 0x95, 0x2518, 0, 2);
    await controlOut(0x9a, 0x2518, 0x00c3);
    await context.controlIn("vendor", "device", 0x95, 0x0706, 0, 2);
    await controlOut(0xa1, 0x501f, 0xd90a);
    await setBaud(9600);
    await controlOut(0xa4, 0xffff, 0);
    await context.controlIn("vendor", "device", 0x95, 0x0706, 0, 2);
    await setBaud(options.baudRate);
    await controlOut(0x9a, 0x2518, 0x00c3);
    await controlOut(0xa4, 0xff9f, 0); // DTR + RTS, active low.
  },
};
