import { describe, expect, it } from "vitest";
import { WebSerialTransport } from "../src/transport-webserial";

describe("serial lifecycle", () => {
  it("reports EOF instead of repeatedly returning empty data to the relay pump", async () => {
    const port = {
      readable: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      writable: new WritableStream<Uint8Array>(),
      async open() {}, async close() {}, getInfo: () => ({})
    };
    const serial = new WebSerialTransport(port);
    await serial.open();
    await expect(serial.read()).rejects.toThrow("Serial connection closed");
    await serial.close();
    expect(serial.isOpen).toBe(false);
    expect(port.readable.locked).toBe(false);
    expect(port.writable.locked).toBe(false);
  });
});
