import type { BrowserSerialPort } from "./browser-serial-port.js";
import { cdcAcmDriver } from "./drivers/cdc-acm.js";
import { ch34xDriver } from "./drivers/ch34x.js";
import { cp210xDriver } from "./drivers/cp210x.js";
import { ftdiDriver } from "./drivers/ftdi.js";
import { prolificDriver } from "./drivers/prolific.js";
import type { WebUsbSerialDriver } from "./webusb-driver.js";
import { WebUsbSerialPort } from "./webusb-port.js";
import type {
  UsbDeviceFilterLike,
  UsbDeviceLike,
  UsbNavigatorLike,
} from "./webusb-types.js";

const DRIVERS: readonly WebUsbSerialDriver[] = [
  ch34xDriver,
  cp210xDriver,
  ftdiDriver,
  prolificDriver,
  cdcAcmDriver,
];

export const WEBUSB_SERIAL_FILTERS: readonly UsbDeviceFilterLike[] = [
  ...new Map(
    DRIVERS.flatMap((driver) => driver.filters)
      .map((filter) => [JSON.stringify(filter), filter]),
  ).values(),
];

export function findWebUsbDriver(device: UsbDeviceLike): WebUsbSerialDriver | null {
  return DRIVERS.find((driver) => driver.supports(device)) ?? null;
}

export async function requestWebUsbSerialPort(
  usb: UsbNavigatorLike,
): Promise<BrowserSerialPort> {
  const device = await usb.requestDevice({ filters: [...WEBUSB_SERIAL_FILTERS] });
  const driver = findWebUsbDriver(device);
  if (!driver) {
    throw new Error(
      `No browser USB-serial driver for ${device.vendorId.toString(16).padStart(4, "0")}:` +
      device.productId.toString(16).padStart(4, "0"),
    );
  }
  return new WebUsbSerialPort(device, driver);
}
