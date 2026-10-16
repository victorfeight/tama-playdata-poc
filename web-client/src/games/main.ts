import "./style.css";
import { requestParadiseSerialPort, type WebSerialTransport } from "@tama-breed-poc/tama-protocol";
import { RelayClient } from "../relay-client";
import { SerialBridge } from "../serial-bridge";
import { Tet3Observer, type Tet3Packet } from "./tet3";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connect = element<HTMLButtonElement>("connect"), create = element<HTMLButtonElement>("create");
const join = element<HTMLButtonElement>("join"), code = element<HTMLInputElement>("code");
const relay = new RelayClient({ baseUrl: import.meta.env.VITE_RELAY_URL ?? location.origin,
  appName: "tamahome-blocks-v1", expectedApp: "tamahome-blocks-v1" });
const observers = { in: new Tet3Observer(), out: new Tet3Observer() };
let serial: WebSerialTransport | undefined, socket: WebSocket | undefined, bridge: SerialBridge | undefined;
let busy = false, generation = 0;
let player: number | undefined, currentRound = 0;
const lines: string[] = [];
function status(text: string) { element("status").textContent = text; }
function controls() {
  connect.disabled = busy; connect.textContent = serial ? "Disconnect" : "Connect Paradise";
  create.disabled = join.disabled = !serial || busy || Boolean(socket);
  code.disabled = busy || Boolean(socket);
  element<HTMLButtonElement>("leave").disabled = busy;
  element("device-state").textContent = serial ? "Connected" : "Not connected";
}
function log(text: string) {
  lines.push(text); if (lines.length > 40) lines.shift(); element("log").textContent = lines.join("\n");
}
function observe(packet: Tet3Packet, direction: "in" | "out") {
  if (packet.round && packet.round < currentRound) return;
  if (packet.type === 4) {
    currentRound = packet.round;
    player = direction === "in" ? packet.b >>> 8 : 0;
    element("round").textContent = String(packet.round); element("match").textContent = "Get ready";
  } else if (packet.type === 5) element("match").textContent = "Playing";
  else if (packet.type === 9 || packet.type === 10) {
    if (player !== undefined && player < 2) {
      const mine = (packet.b >>> (player * 2)) & 3, theirs = (packet.b >>> ((player ^ 1) * 2)) & 3;
      element("match").textContent = `You ${mine} · Friend ${theirs}${packet.type === 10 ? " · Finished" : ""}`;
    }
  } else if (packet.type === 12 || packet.type === 15) element("match").textContent = "Disconnected";
}
async function disconnect(message: string) {
  ++generation;
  const oldBridge = bridge, oldSocket = socket, oldSerial = serial;
  bridge = undefined; socket = undefined; serial = undefined;
  oldBridge?.stop(); oldSocket?.close();
  await oldSerial?.close();
  observers.in.reset(); observers.out.reset();
  player = undefined; currentRound = 0;
  element("room").hidden = true; element("play-instructions").hidden = true;
  element("round").textContent = "—"; element("match").textContent = "Waiting";
  status(message); controls();
}
async function run(action: () => Promise<void>) {
  if (busy) return; busy = true; controls();
  try { await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed. Try again.";
    // A mistyped/expired room does not invalidate a healthy USB connection.
    if (serial && !socket) status(message); else await disconnect(message);
  }
  finally { busy = false; controls(); }
}
connect.addEventListener("click", () => void run(async () => {
  if (serial) return disconnect("Disconnected. You can reconnect when ready.");
  const selected = await requestParadiseSerialPort();
  try { await selected.open({ baudRate: 460800 }); }
  catch (error) { await selected.close(); throw error; }
  serial = selected; status("Connected. Create a room or join your friend’s code. Keep the game on its main menu.");
}));
async function enter(role: "a" | "b") {
  if (!serial) return;
  const input = code.value.trim().toUpperCase();
  if (role === "b" && !/^[A-Z0-9]{6}$/.test(input)) { status("Enter your friend’s six-character room code."); return; }
  const room = role === "a" ? await relay.createRoom() : { code: input, token: await relay.fetchToken(input) };
  const current = ++generation, ws = relay.connect(room.code, role, room.token); socket = ws;
  let peerPresent = false;
  // Listen before OPEN so neither the first peer notification nor a close is lost.
  ws.addEventListener("message", event => {
    if (generation !== current || typeof event.data !== "string") return;
    if (event.data === "peer connected") {
      peerPresent = true;
      status("Your friend is here. Start the game on both toys."); element("play-instructions").hidden = false;
    } else if (event.data === "peer disconnected") {
      // End this session; do not feed a replacement peer an old game's bytes.
      void disconnect("Your friend disconnected. Reconnect and create a fresh room to play again.");
    }
  });
  ws.addEventListener("close", () => { if (generation === current) void disconnect("Room connection closed. Reconnect to try again."); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error("Room connection timed out.")); }, 10000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to the room.")); }, { once: true });
    ws.addEventListener("close", () => { clearTimeout(timer); reject(new Error("Room closed before connecting.")); }, { once: true });
  });
  if (generation !== current || !serial) return;
  element("room").hidden = false; element("room-code").textContent = room.code;
  status(peerPresent ? "Your friend is here. Start Versus on both toys." : "Room ready. Waiting for your friend. Keep the game on its main menu.");
  bridge = new SerialBridge(serial, ws, {
    bytes(direction, bytes, counts) {
      if (generation !== current) return;
      for (const packet of observers[direction].push(bytes)) {
        observe(packet, direction);
        if (packet.type !== 2 && packet.type !== 11) log(`${direction === "out" ? "Toy" : "Peer"}: message ${packet.type}, round ${packet.round}`);
      }
      element("traffic").textContent = `${counts.bytesOut} bytes sent · ${counts.bytesIn} received · ${observers.in.invalid + observers.out.invalid} unrecognized frames`;
    },
    error() { if (generation === current) void disconnect("Device connection lost. Reconnect and start a fresh room."); }
  });
  bridge.start();
}
create.addEventListener("click", () => void run(() => enter("a")));
join.addEventListener("click", () => void run(() => enter("b")));
element("leave").addEventListener("click", () => void run(() => disconnect("You left the room. Reconnect to play again.")));
element("copy").addEventListener("click", () => {
  void navigator.clipboard.writeText(element("room-code").textContent ?? "").then(
    () => status("Room code copied."), () => status("Copy the six-character code shown above."));
});
window.addEventListener("pagehide", () => { bridge?.stop(); socket?.close(); void serial?.close(); });
controls();
// Optional staging manifest: the package builder verifies the source receipt
// before including a payload. Missing manifest simply leaves manual send intact.
void fetch("./payload.json").then(async response => {
  if (!response.ok) return;
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("file" in data) || !("sha256" in data)) return;
  const { file, sha256 } = data;
  if (typeof file !== "string" || !/^blocks\.[a-f0-9]{12}\.pdlo\.bin$/.test(file) ||
      typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) return;
  const link = element<HTMLAnchorElement>("payload-link");
  link.href = `./${file}`; link.title = `SHA-256: ${sha256}`; element("download").hidden = false;
}).catch(() => { /* The preview can also use a manually supplied payload. */ });
