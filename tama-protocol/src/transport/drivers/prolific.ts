import type {
  WebUsbDriverContext,
  WebUsbSerialDriver,
} from "../webusb-driver.js";
import { firstBulkLayout } from "../webusb-types.js";

const VENDOR_ID = 0x067b;
const PRODUCT_IDS = new Set([0x2303, 0x23a3, 0x23b3, 0x23c3, 0x23d3, 0x23e3, 0x23f3]);
type ProlificType = "01" | "T" | "HX" | "HXN";
const deviceTypes = new WeakMap<WebUsbDriverContext, ProlificType>();

function lineCoding(baudRate: number): Uint8Array {
  const bytes = new Uint8Array(7);
  new DataView(bytes.buffer).setUint32(0, baudRate, true);
  bytes[4] = 0;
  bytes[5] = 0;
  bytes[6] = 8;
  return bytes;
}

async function detectType(context: WebUsbDriverContext): Promise<ProlificType> {
  const device = context.device;
  if (device.productId !== 0x2303) return "HXN";
  if (device.deviceClass === 0x02) return "01";
  if (device.usbVersionMajor === 2) {
    if (device.deviceVersionMajor === 3 || device.deviceVersionMajor === 5) {
      try {
        await context.controlIn("vendor", "device", 0x01, 0x8080, 0, 1);
        return "T";
      } catch {
        return "HXN";
      }
    }
    return "HXN";
  }
  return "HX";
}

function vendorOut(
  context: WebUsbDriverContext,
  type: ProlificType,
  value: number,
  index: number,
): Promise<void> {
  return context.controlOut(
    "vendor", "device", type === "HXN" ? 0x80 : 0x01, value, index,
  );
}

function vendorIn(
  context: WebUsbDriverContext,
  type: ProlificType,
  value: number,
  index: number,
): Promise<Uint8Array> {
  return context.controlIn(
    "vendor", "device", type === "HXN" ? 0x81 : 0x01, value, index, 1,
  );
}

async function purge(context: WebUsbDriverContext, type: ProlificType): Promise<void> {
  if (type === "HXN") {
    await vendorOut(context, type, 0x07, 0x03);
  } else {
    await vendorOut(context, type, 0x08, 0);
    await vendorOut(context, type, 0x09, 0);
  }
}

export const prolificDriver: WebUsbSerialDriver = {
  name: "PL2303",
  filters: [...PRODUCT_IDS].map((productId) => ({ vendorId: VENDOR_ID, productId })),
  supports: (device) =>
    device.vendorId === VENDOR_ID && PRODUCT_IDS.has(device.productId),
  layout: firstBulkLayout,
  initialize: async (context, options) => {
    const type = await detectType(context);
    deviceTypes.set(context, type);
    await purge(context, type);

    if (type !== "HXN") {
      await vendorIn(context, type, 0x8484, 0);
      await vendorOut(context, type, 0x0404, 0);
      await vendorIn(context, type, 0x8484, 0);
      await vendorIn(context, type, 0x8383, 0);
      await vendorIn(context, type, 0x8484, 0);
      await vendorOut(context, type, 0x0404, 1);
      await vendorIn(context, type, 0x8484, 0);
      await vendorIn(context, type, 0x8383, 0);
      await vendorOut(context, type, 0, 1);
      await vendorOut(context, type, 1, 0);
      await vendorOut(context, type, 2, type === "01" ? 0x24 : 0x44);
    }

    await context.controlOut("class", "interface", 0x22, 0x0000, 0);
    if (type === "HXN") await vendorOut(context, type, 0x0a, 0xff);
    else await vendorOut(context, type, 0, 0);
    await context.controlOut(
      "class", "interface", 0x20, 0, 0, lineCoding(options.baudRate),
    );
    await purge(context, type);
    await context.controlOut("class", "interface", 0x22, 0x0003, 0);
  },
  shutdown: async (context) => {
    const type = deviceTypes.get(context);
    if (type) await purge(context, type);
    deviceTypes.delete(context);
  },
};
