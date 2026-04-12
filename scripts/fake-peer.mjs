#!/usr/bin/env node
import fs from "node:fs";
import WebSocket from "ws";

const [url, file] = process.argv.slice(2);
if (!url || !file) {
  console.error("usage: fake-peer.mjs ws://localhost:3001/ws/CODE?role=b capture.bin");
  process.exit(1);
}

const payload = fs.readFileSync(file);
const ws = new WebSocket(url, {
  headers: { "x-poc-secret": process.env.SHARED_SECRET ?? "dev-only" }
});

ws.on("open", () => {
  ws.send(payload);
  console.error(`sent ${payload.length} bytes`);
});

ws.on("message", (data) => {
  console.error(`received ${Buffer.byteLength(data)} bytes`);
});
