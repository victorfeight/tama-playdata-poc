export interface UsbEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous";
  packetSize: number;
}

export interface UsbAlternateLike {
  alternateSetting: number;
  interfaceClass?: number;
  interfaceSubclass?: number;
  interfaceProtocol?: number;
  endpoints: readonly UsbEndpointLike[];
}

export interface UsbInterfaceLike {
  interfaceNumber: number;
  alternates: readonly UsbAlternateLike[];
}

export interface UsbConfigurationLike {
  configurationValue: number;
  interfaces: readonly UsbInterfaceLike[];
}

export interface UsbTransferResultLike {
  status: string;
  data?: DataView | null;
  bytesWritten?: number;
}

export interface UsbControlTransferParameters {
  requestType: "standard" | "class" | "vendor";
  recipient: "device" | "interface" | "endpoint" | "other";
  request: number;
  value: number;
  index: number;
}

export interface UsbDeviceLike {
  readonly vendorId: number;
  readonly productId: number;
  readonly deviceClass?: number;
  readonly usbVersionMajor?: number;
  readonly deviceVersionMajor?: number;
  readonly configurations: readonly UsbConfigurationLike[];
  configuration: UsbConfigurationLike | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(
    interfaceNumber: number,
    alternateSetting: number,
  ): Promise<void>;
  controlTransferIn(
    setup: UsbControlTransferParameters,
    length: number,
  ): Promise<UsbTransferResultLike>;
  controlTransferOut(
    setup: UsbControlTransferParameters,
    data?: BufferSource,
  ): Promise<UsbTransferResultLike>;
  transferIn(endpointNumber: number, length: number): Promise<UsbTransferResultLike>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<UsbTransferResultLike>;
}

export interface UsbDeviceFilterLike {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
}

export interface UsbNavigatorLike {
  requestDevice(options: {
    filters: ReadonlyArray<UsbDeviceFilterLike>;
  }): Promise<UsbDeviceLike>;
}

export interface UsbPortLayout {
  claimedInterfaces: readonly number[];
  interfaceAlternates?: ReadonlyArray<{
    interfaceNumber: number;
    alternateSetting: number;
  }>;
  controlInterface: number;
  input: UsbEndpointLike;
  output: UsbEndpointLike;
}

export function copyForUsb(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

export function firstBulkLayout(configuration: UsbConfigurationLike): UsbPortLayout {
  for (const usbInterface of configuration.interfaces) {
    for (const alternate of usbInterface.alternates) {
      const input = alternate.endpoints.find(
        (endpoint) => endpoint.type === "bulk" && endpoint.direction === "in",
      );
      const output = alternate.endpoints.find(
        (endpoint) => endpoint.type === "bulk" && endpoint.direction === "out",
      );
      if (input && output) {
        return {
          claimedInterfaces: [usbInterface.interfaceNumber],
          interfaceAlternates: [{
            interfaceNumber: usbInterface.interfaceNumber,
            alternateSetting: alternate.alternateSetting,
          }],
          controlInterface: usbInterface.interfaceNumber,
          input,
          output,
        };
      }
    }
  }
  throw new Error("USB serial adapter has no bulk input/output endpoints");
}

export function alternateWithClass(
  configuration: UsbConfigurationLike,
  interfaceClass: number,
): { usbInterface: UsbInterfaceLike; alternate: UsbAlternateLike } | null {
  for (const usbInterface of configuration.interfaces) {
    for (const alternate of usbInterface.alternates) {
      if (alternate.interfaceClass === interfaceClass) return { usbInterface, alternate };
    }
  }
  return null;
}
