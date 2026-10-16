// JSON-lines bridge for the native guest probe. Uses the real room API and ws.
// Never prints room tokens. Caller supplies a private, running relay URL.
import { createInterface } from "node:readline";
import { WebSocket } from "ws";
const base = process.argv[2];
if (!base) throw new Error("Usage: game-relay-peer.mjs http://127.0.0.1:PORT");
const response = await fetch(`${base}/sessions`, { method: "POST", headers: { "x-app-name": "tamahome-game-probe" } });
if (!response.ok) throw new Error(`Create room: ${response.status}`);
const room = await response.json();
const joined = await fetch(`${base}/sessions/${room.code}/join`, { method: "POST" });
if (!joined.ok || (await joined.json()).token !== room.token) throw new Error("Join room failed");
const pending = [[], []];
const sockets = ["a", "b"].map((role, i) => {
  const url = new URL(`/ws/${room.code}`, base.replace(/^http/, "ws")); url.searchParams.set("role", role);
  const ws = new WebSocket(url, room.token);
  ws.on("message", (data, binary) => { if (binary) pending[i].push(Buffer.from(data)); });
  return ws;
});
await Promise.all(sockets.map(ws => new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); })));
console.log(JSON.stringify({ ready: true }));
try {
  for await (const line of createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    for (let i = 0; i < 2; i++) if (request.out[i]) sockets[i].send(Buffer.from(request.out[i], "hex"));
    await new Promise(resolve => setTimeout(resolve, 5));
    const incoming = pending.map(queue => { const bytes = Buffer.concat(queue); queue.length = 0; return bytes.toString("hex"); });
    console.log(JSON.stringify({ in: incoming }));
  }
} finally { for (const ws of sockets) ws.close(); }
