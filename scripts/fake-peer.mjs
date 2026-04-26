#!/usr/bin/env node
// Bytes-from-file injector for testing the relay end-to-end without two
// real Paradises. Usage:
//   fake-peer.mjs http://localhost:3001 CODE b capture.bin
// Looks up the per-session token via /sessions/:code/join, opens the WS
// for the given role, dumps the file bytes, then echoes anything sent
// back from the peer.
import fs from "node:fs";
import WebSocket from "ws";

const [baseUrl, code, role, file] = process.argv.slice(2);
if (!baseUrl || !code || !role || !file) {
  console.error("usage: fake-peer.mjs http://localhost:3001 CODE [a|b] capture.bin");
  process.exit(1);
}
if (role !== "a" && role !== "b") {
  console.error(`role must be 'a' or 'b', got '${role}'`);
  process.exit(1);
}

const joinResp = await fetch(`${baseUrl.replace(/\/$/, "")}/sessions/${code}/join`, {
  method: "POST",
  headers: { "x-app-name": "fake-peer-script" }
});
if (!joinResp.ok) {
  console.error(`join failed: ${joinResp.status} ${await joinResp.text()}`);
  process.exit(1);
}
const { token } = await joinResp.json();

const payload = fs.readFileSync(file);
const wsUrl = `${baseUrl.replace(/^http/, "ws").replace(/\/$/, "")}/ws/${code}?role=${role}&token=${token}`;
const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  ws.send(payload);
  console.error(`sent ${payload.length} bytes`);
});

ws.on("message", (data) => {
  console.error(`received ${Buffer.byteLength(data)} bytes`);
});
