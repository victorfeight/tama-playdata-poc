import type { BrowserSerialOpenOptions } from "./browser-serial-port.js";
import {
  copyForUsb,
  type UsbConfigurationLike,
  type UsbControlTransferParameters,
  type UsbDeviceFilterLike,
  type UsbDeviceLike,
  type UsbPortLayout,
} from "./webusb-types.js";

export interface WebUsbSerialDriver {
  readonly name: string;
  readonly filters: readonly UsbDeviceFilterLike[];
  supports(device: UsbDeviceLike): boolean;
  layout(configuration: UsbConfigurationLike): UsbPortLayout;
  initialize(context: WebUsbDriverContext, options: BrowserSerialOpenOptions): Promise<void>;
  shutdown?(context: WebUsbDriverContext): Promise<void>;
  transformInput?(data: Uint8Array, packetSize: number): Uint8Array;
}

export class WebUsbDriverContext {
  constructor(
    readonly device: UsbDeviceLike,
    readonly layout: UsbPortLayout,
  ) {}

  async controlIn(
    requestType: UsbControlTransferParameters["requestType"],
    recipient: UsbControlTransferParameters["recipient"],
    request: number,
    value: number,
    index: number,
    length: number,
  ): Promise<Uint8Array> {
    const result = await this.device.controlTransferIn(
      { requestType, recipient, request, value, index },
      length,
    );
    if (result.status !== "ok" || !result.data || result.data.byteLength !== length) {
      throw new Error(`USB serial control read 0x${request.toString(16)} failed`);
    }
    return new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    ).slice();
  }

  async controlOut(
    requestType: UsbControlTransferParameters["requestType"],
    recipient: UsbControlTransferParameters["recipient"],
    request: number,
    value: number,
    index: number,
    data?: Uint8Array,
  ): Promise<void> {
    const payload = data ? copyForUsb(data) : undefined;
    const result = await this.device.controlTransferOut(
      { requestType, recipient, request, value, index },
      payload,
    );
    if (result.status !== "ok" ||
        (payload && result.bytesWritten !== undefined &&
          result.bytesWritten !== payload.byteLength)) {
      throw new Error(`USB serial control write 0x${request.toString(16)} failed`);
    }
  }
}
