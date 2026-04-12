export enum PacketType {
  HANDSHAKE = 0x0,
  PLAYDATE = 0x1,
  GIFT = 0x2,
  DOWNLOAD = 0x3
}

export interface Packet<TType extends PacketType = PacketType> {
  type: TType;
  payload: Uint8Array;
}

export interface GiftVersionPacket {
  version: number;
}

export interface GiftItemPacket {
  itemId: number;
}

export function encodeU16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

export function encodeU32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}
