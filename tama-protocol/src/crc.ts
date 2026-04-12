const POLY_REVERSED = 0xa001;

export function crc16Ibm(data: Uint8Array): number {
  let crc = 0;

  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const carry = crc & 1;
      crc >>>= 1;
      if (carry) crc ^= POLY_REVERSED;
    }
  }

  return crc & 0xffff;
}
