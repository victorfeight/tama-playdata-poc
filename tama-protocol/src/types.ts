export enum TCPState {
  IDLE = "IDLE",
  INITIATING = "INITIATING",
  LISTENING = "LISTENING",
  SENDING = "SENDING",
  RECEIVING = "RECEIVING",
  ECHO = "ECHO"
}

export enum TCPEchoResult {
  REQUESTING = "REQUESTING",
  RESPONDED = "RESPONDED",
  TIMEOUT = "TIMEOUT"
}

export enum TCPResult {
  NONE = "NONE",
  SUCCESS = "SUCCESS",
  FAILURE = "FAILURE",
  CANCELLED = "CANCELLED"
}

export enum TCPCallbackType {
  CHUNK_RECEIVED = "CHUNK_RECEIVED",
  CHUNK_PREPARE_TO_SEND = "CHUNK_PREPARE_TO_SEND",
  CUSTOM_CMD = "CUSTOM_CMD",
  SUCCESS = "SUCCESS",
  FAILURE = "FAILURE"
}

export enum RomType {
  WATER = 0,
  JADE = 1,
  SKY = 2
}

export enum PlayType {
  VISIT = 0,
  PLAYDATE = 1,
  GIFT = 2,
  BREED = 4
}

export const PARADISE_BAUD_RATE = 460800;
export const SERIAL_DATA_BITS = 8;
export const SERIAL_STOP_BITS = 1;
export const SERIAL_PARITY = "none" as const;
