import { RomType } from "./types";

export interface FriendData {
  deviceUid: number;
  charaUid: number;
  friendship: number;
  result: number;
  hunger: number;
  happiness: number;
  isInLove: boolean;
}

export interface PlayData {
  forceSendAway: number;
  romType: RomType;
  friendData: FriendData;
}

export const PLAY_DATA_LENGTH = 20;

export function encodePlayData(data: PlayData): Uint8Array {
  const out = new Uint8Array(PLAY_DATA_LENGTH);
  const view = new DataView(out.buffer);
  view.setUint16(0, data.forceSendAway, true);
  view.setUint16(2, data.romType, true);
  view.setUint32(4, data.friendData.deviceUid >>> 0, true);
  view.setUint32(8, data.friendData.charaUid >>> 0, true);
  view.setUint16(12, data.friendData.friendship, true);
  view.setUint16(14, data.friendData.result, true);
  view.setUint8(16, data.friendData.hunger);
  view.setUint8(17, data.friendData.happiness);
  view.setUint16(18, data.friendData.isInLove ? 1 : 0, true);
  return out;
}

export function decodePlayData(payload: Uint8Array): PlayData {
  if (payload.length < PLAY_DATA_LENGTH) throw new Error(`play data too short: ${payload.length}`);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    forceSendAway: view.getUint16(0, true),
    romType: view.getUint16(2, true),
    friendData: {
      deviceUid: view.getUint32(4, true),
      charaUid: view.getUint32(8, true),
      friendship: view.getUint16(12, true),
      result: view.getUint16(14, true),
      hunger: view.getUint8(16),
      happiness: view.getUint8(17),
      isInLove: (view.getUint16(18, true) & 1) === 1
    }
  };
}
