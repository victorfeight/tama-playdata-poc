import { PARADISE_BAUD_RATE } from "./types";

export interface Transport {
  readonly name: string;
  read(timeoutMs?: number): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface ByteTransport extends Transport {
  readonly isOpen: boolean;
}

export interface SerialOpenOptions {
  baudRate?: number;
}

export const DEFAULT_SERIAL_OPTIONS: Required<SerialOpenOptions> = {
  baudRate: PARADISE_BAUD_RATE
};

export class TimeoutError extends Error {
  constructor(message = "transport read timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
