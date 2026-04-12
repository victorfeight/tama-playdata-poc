import { describe, expect, it } from "vitest";
import { crc16Ibm } from "../src/crc";

describe("crc16Ibm", () => {
  it("matches the standard CRC-16/IBM check vector", () => {
    expect(crc16Ibm(new TextEncoder().encode("123456789"))).toBe(0xbb3d);
  });

  it("returns zero for empty input", () => {
    expect(crc16Ibm(new Uint8Array())).toBe(0);
  });
});
