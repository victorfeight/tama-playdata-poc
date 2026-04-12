import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../src/server";

const secret = "test-secret";
let closeServer: undefined | (() => Promise<void>);

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

describe("relay server", () => {
  it("relays bytes both directions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tama-relay-"));
    const app = await buildServer({
      port: 0,
      sharedSecret: secret,
      dbPath: path.join(dir, "sessions.db"),
      sessionTtlMs: 600_000
    });
    await app.listen({ port: 0 });
    closeServer = async () => app.close();

    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const createResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { "x-poc-secret": secret }
    });
    const { code } = createResponse.json<{ code: string }>();

    const a = connect(port, code, "a");
    const b = connect(port, code, "b");
    await Promise.all([opened(a), opened(b)]);

    const gotAtB = onceBinaryMessage(b);
    a.send(Buffer.from([1, 2, 3]));
    expect([...new Uint8Array(await gotAtB)]).toEqual([1, 2, 3]);

    const gotAtA = onceBinaryMessage(a);
    b.send(Buffer.from([4, 5, 6]));
    expect([...new Uint8Array(await gotAtA)]).toEqual([4, 5, 6]);

    a.close();
    b.close();
  });
});

function connect(port: number, code: string, role: "a" | "b"): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/${code}?role=${role}`, {
    headers: { "x-poc-secret": secret }
  });
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function onceBinaryMessage(ws: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) {
        ws.once("message", onMessage);
        return;
      }
      resolve(Buffer.isBuffer(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data as ArrayBuffer);
    };
    ws.once("message", onMessage);
  });
}
