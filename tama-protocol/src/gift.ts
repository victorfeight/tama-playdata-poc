import { PacketType, encodeU16, encodeU32 } from "./packets";

export const GIFT_PACKET_TYPE = PacketType.GIFT;
export const GIFT_RELEASE_VERSION = 1;
export const GIFT_VERSION_PAYLOAD_LENGTH = 4;
export const GIFT_ITEM_PAYLOAD_LENGTH = 2;

export interface GiftVersionPayload {
  version: number;
}

export interface GiftItemPayload {
  itemId: number;
}

export type GiftPhase = "version" | "item";

export interface GiftPayload {
  phase: GiftPhase;
  version?: number;
  itemId?: number;
}

export function buildGiftVersionPayload(version = GIFT_RELEASE_VERSION): Uint8Array {
  assertU32(version, "version");
  return encodeU32(version);
}

export function parseGiftVersionPayload(payload: Uint8Array): GiftVersionPayload {
  assertPayloadLength(payload, GIFT_VERSION_PAYLOAD_LENGTH, "gift version");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { version: view.getUint32(0, true) };
}

export function buildGiftItemPayload(itemId: number): Uint8Array {
  assertU16(itemId, "itemId");
  return encodeU16(itemId);
}

export function parseGiftItemPayload(payload: Uint8Array): GiftItemPayload {
  assertPayloadLength(payload, GIFT_ITEM_PAYLOAD_LENGTH, "gift item");
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return { itemId: view.getUint16(0, true) };
}

export function parseGiftPayload(payload: Uint8Array): GiftPayload {
  if (payload.byteLength === GIFT_VERSION_PAYLOAD_LENGTH) {
    return { phase: "version", ...parseGiftVersionPayload(payload) };
  }
  if (payload.byteLength === GIFT_ITEM_PAYLOAD_LENGTH) {
    return { phase: "item", ...parseGiftItemPayload(payload) };
  }
  throw new Error(`unsupported gift payload length ${payload.byteLength}`);
}

function assertPayloadLength(payload: Uint8Array, expected: number, label: string): void {
  if (payload.byteLength !== expected) {
    throw new Error(`${label} payload must be ${expected} bytes, got ${payload.byteLength}`);
  }
}

function assertU16(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${label} must be an unsigned 16-bit integer`);
  }
}

function assertU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer`);
  }
}
