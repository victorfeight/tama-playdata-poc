import { describe, expect, it } from "vitest";
import { SerialBatcher } from "../../web-client/src/serial-batcher";

describe("serial batching", () => {
  it("combines short reads without changing byte order", async () => {
    const sent: Uint8Array[] = [];
    const batcher = new SerialBatcher((bytes) => sent.push(bytes), 4096, 2);
    batcher.push(new Uint8Array([1, 2]));
    batcher.push(new Uint8Array([3, 4]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent.map((bytes) => [...bytes])).toEqual([[1, 2, 3, 4]]);
    batcher.discard();
  });

  it("flushes a complete control line without waiting for the timer", () => {
    const sent: Uint8Array[] = [];
    const batcher = new SerialBatcher((bytes) => sent.push(bytes));
    batcher.push(new TextEncoder().encode("AC"));
    batcher.push(new TextEncoder().encode("K\r\n"));
    expect(sent.map((bytes) => new TextDecoder().decode(bytes))).toEqual(["ACK\r\n"]);
    batcher.discard();
  });

  it("flushes at the size limit and discards unsent bytes on close", () => {
    const sent: Uint8Array[] = [];
    const batcher = new SerialBatcher((bytes) => sent.push(bytes), 4, 100);
    batcher.push(new Uint8Array([1, 2]));
    batcher.push(new Uint8Array([3, 4]));
    batcher.push(new Uint8Array([5]));
    batcher.discard();
    expect(sent.map((bytes) => [...bytes])).toEqual([[1, 2, 3, 4]]);
  });
});
