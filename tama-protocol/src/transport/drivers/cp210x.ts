import type { WebUsbSerialDriver } from "../webusb-driver.js";
import { firstBulkLayout } from "../webusb-types.js";

const VENDOR_ID = 0x10c4;
const PRODUCT_IDS = new Set([0xea60, 0xea70, 0xea71]);

function uint32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

export const cp210xDriver: WebUsbSerialDriver = {
  name: "CP210x",
  filters: [...PRODUCT_IDS].map((productId) => ({ vendorId: VENDOR_ID, productId })),
  supports: (device) =>
    device.vendorId === VENDOR_ID && PRODUCT_IDS.has(device.productId),
  layout: firstBulkLayout,
  initialize: async (context, options) => {
    const index = context.layout.controlInterface;
    const out = (request: number, value: number, data?: Uint8Array) =>
      context.controlOut("vendor", "interface", request, value, index, data);

    await out(0x00, 0x0001); // UART enable.
    await out(0x07, 0x0300); // Initialize DTR + RTS deasserted.
    const flow = new Uint8Array(16);
    await out(0x13, 0, flow);
    await out(0x1e, 0, uint32Le(options.baudRate));
    await out(0x03, 0x0800); // 8 data bits, no parity, 1 stop bit.
    await out(0x07, 0x0101); // Assert DTR.
    await out(0x07, 0x0202); // Assert RTS without altering DTR.
  },
  shutdown: async (context) => {
    const index = context.layout.controlInterface;
    await context.controlOut("vendor", "interface", 0x12, 0x000f, index);
    await context.controlOut("vendor", "interface", 0x00, 0x0000, index);
  },
};
