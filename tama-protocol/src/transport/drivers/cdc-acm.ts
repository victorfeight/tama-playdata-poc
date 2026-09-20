import type { WebUsbSerialDriver } from "../webusb-driver.js";
import {
  alternateWithClass,
  type UsbConfigurationLike,
  type UsbEndpointLike,
  type UsbPortLayout,
} from "../webusb-types.js";

const CDC_CONTROL_CLASS = 0x02;
const CDC_DATA_CLASS = 0x0a;
const WCH_VENDOR_ID = 0x1a86;
const WCH_CDC_PRODUCTS = [
  0x55d2, 0x55d3, 0x55d4, 0x55d5, 0x55d6, 0x55d7, 0x55d8,
  0x55da, 0x55db, 0x55dd, 0x55de, 0x55df,
  0x55e7, 0x55e8, 0x55e9, 0x55ea, 0x55eb, 0x55ec, 0x55ef,
];

function layout(configuration: UsbConfigurationLike): UsbPortLayout {
  const control = alternateWithClass(configuration, CDC_CONTROL_CLASS);
  const data = alternateWithClass(configuration, CDC_DATA_CLASS);
  if (!control || !data) throw new Error("CDC-ACM control/data interfaces are unavailable");
  const input = data.alternate.endpoints.find(
    (endpoint): endpoint is UsbEndpointLike =>
      endpoint.type === "bulk" && endpoint.direction === "in",
  );
  const output = data.alternate.endpoints.find(
    (endpoint): endpoint is UsbEndpointLike =>
      endpoint.type === "bulk" && endpoint.direction === "out",
  );
  if (!input || !output) throw new Error("CDC-ACM data endpoints are unavailable");
  return {
    claimedInterfaces: [
      control.usbInterface.interfaceNumber,
      data.usbInterface.interfaceNumber,
    ],
    interfaceAlternates: [
      {
        interfaceNumber: control.usbInterface.interfaceNumber,
        alternateSetting: control.alternate.alternateSetting,
      },
      {
        interfaceNumber: data.usbInterface.interfaceNumber,
        alternateSetting: data.alternate.alternateSetting,
      },
    ],
    controlInterface: control.usbInterface.interfaceNumber,
    input,
    output,
  };
}

function lineCoding(baudRate: number): Uint8Array {
  const bytes = new Uint8Array(7);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, baudRate, true);
  bytes[4] = 0; // 1 stop bit.
  bytes[5] = 0; // No parity.
  bytes[6] = 8;
  return bytes;
}

export const cdcAcmDriver: WebUsbSerialDriver = {
  name: "CDC-ACM",
  filters: [
    { classCode: CDC_CONTROL_CLASS },
    ...WCH_CDC_PRODUCTS.map((productId) => ({ vendorId: WCH_VENDOR_ID, productId })),
  ],
  supports: (device) => device.configurations.some((configuration) =>
    alternateWithClass(configuration, CDC_CONTROL_CLASS) !== null &&
    alternateWithClass(configuration, CDC_DATA_CLASS) !== null
  ),
  layout,
  initialize: async (context, options) => {
    const index = context.layout.controlInterface;
    await context.controlOut(
      "class", "interface", 0x20, 0, index, lineCoding(options.baudRate),
    );
    await context.controlOut("class", "interface", 0x22, 0x0003, index);
  },
  shutdown: (context) => context.controlOut(
    "class", "interface", 0x22, 0x0000, context.layout.controlInterface,
  ),
};
