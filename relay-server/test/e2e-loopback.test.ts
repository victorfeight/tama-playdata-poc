import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { buildServer } from "../src/server";
import { openDb } from "../src/db";

let closeServer: undefined | (() => Promise<void>);

afterEach(async () => {
  await closeServer?.();
  closeServer = undefined;
});

describe("relay server", () => {
  it("separates proxy visitors, ignores spoofed hops and keeps reconnect limits separate from creation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tama-relay-proxy-"));
    const app = await buildServer({ port: 0, dbPath: path.join(dir, "sessions.db"), sessionTtlMs: 600_000,
      trustedProxyCidrs: ["loopback", "173.245.48.0/20"] });
    closeServer = async () => app.close();
    const headers = { "x-forwarded-for": "203.0.113.7, 173.245.48.1" };
    const first = await app.inject({ method: "POST", url: "/sessions", headers, remoteAddress: "127.0.0.1" });
    const { code, token } = first.json();
    expect(first.statusCode).toBe(201);
    for (let i = 0; i < 12; i++) {
      const joined = await app.inject({ method: "POST", url: `/sessions/${code}/join`, headers, remoteAddress: "127.0.0.1" });
      expect(joined.statusCode).toBe(200); expect(joined.json().token).toBe(token);
    }
    // Creation retains its ten-per-minute bound, unaffected by joining.
    for (let i = 1; i < 10; i++)
      expect((await app.inject({ method: "POST", url: "/sessions", headers, remoteAddress: "127.0.0.1" })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/sessions", headers, remoteAddress: "127.0.0.1" })).statusCode).toBe(429);
    // A made-up leftmost hop cannot change the actual visitor's bucket.
    expect((await app.inject({ method: "POST", url: "/sessions", remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.7, 173.245.48.1" } })).statusCode).toBe(429);
    // Another visitor behind the same trusted edge still has their own limit.
    expect((await app.inject({ method: "POST", url: "/sessions", remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.8, 173.245.48.1" } })).statusCode).toBe(201);
    // A direct untrusted peer cannot evade its bucket by supplying XFF.
    for (let i = 0; i < 11; i++) {
      const result = await app.inject({ method: "POST", url: "/sessions", remoteAddress: "198.51.100.1",
        headers: { "x-forwarded-for": `203.0.113.${20 + i}` } });
      expect(result.statusCode).toBe(i < 10 ? 201 : 429);
    }
  });
  it("relays bytes both directions", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tama-relay-"));
    const app = await buildServer({
      port: 0,
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
      headers: { "x-app-name": "test" }
    });
    const { code, token } = createResponse.json<{ code: string; token: string }>();

    const joinResponse = await app.inject({ method: "POST", url: `/sessions/${code}/join` });
    expect(joinResponse.json<{ token: string }>().token).toBe(token);

    const a = connect(port, code, "a", token);
    const b = connect(port, code, "b", token);
    await Promise.all([opened(a), opened(b)]);

    const gotAtB = onceBinaryMessage(b);
    a.send(Buffer.from([1, 2, 3]));
    expect([...new Uint8Array(await gotAtB)]).toEqual([1, 2, 3]);

    const gotAtA = onceBinaryMessage(a);
    b.send(Buffer.from([4, 5, 6]));
    expect([...new Uint8Array(await gotAtA)]).toEqual([4, 5, 6]);

    const aClosed = closed(a);
    const peerLeft = onceTextMessage(b);
    a.close();
    await aClosed;
    expect(await peerLeft).toBe("peer disconnected");
    expect(b.readyState).toBe(WebSocket.OPEN);
    const rejoined = onceTextMessage(b);
    const a2 = connect(port, code, "a", token);
    await opened(a2);
    expect(await rejoined).toBe("peer connected");
    const gotAtRejoinedA = onceBinaryMessage(a2);
    b.send(Buffer.from([7]));
    expect([...new Uint8Array(await gotAtRejoinedA)]).toEqual([7]);
    const a2Replaced = closed(a2);
    const a3 = connect(port, code, "a", token);
    await opened(a3);
    await a2Replaced;
    expect(b.readyState).toBe(WebSocket.OPEN);
    const gotAtReplacement = onceBinaryMessage(a3);
    b.send(Buffer.from([8]));
    expect([...new Uint8Array(await gotAtReplacement)]).toEqual([8]);
    const a3Closed = closed(a3);
    const bClosed = closed(b);
    a3.close();
    b.close();
    await Promise.all([a3Closed, bClosed]);
    const db = openDb(path.join(dir, "sessions.db"));
    const counts = db.prepare("SELECT bytes_ab, bytes_ba FROM sessions WHERE code = ?").get(code) as { bytes_ab: number; bytes_ba: number };
    expect(counts).toEqual({ bytes_ab: 3, bytes_ba: 5 });
    db.close();
  });
});

function connect(port: number, code: string, role: "a" | "b", token: string): WebSocket {
  // Token rides in Sec-WebSocket-Protocol (subprotocol smuggling).
  return new WebSocket(`ws://127.0.0.1:${port}/ws/${code}?role=${role}`, token);
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once("close", resolve));
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

function onceTextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        ws.once("message", onMessage);
        return;
      }
      resolve(data.toString());
    };
    ws.once("message", onMessage);
  });
}
