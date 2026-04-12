import "./ui/styles.css";
import { config } from "./config";
import { composeGhostPreview, resolveBodyId } from "./ghost-compositor";
import { toGhostPreview } from "./ghost-preview";
import { RelayClient } from "./relay-client";
import { SerialBridge } from "./serial-bridge";
import { StateMachine } from "./state";
import { Drawer } from "./ui/drawer";
import { ExchangeScreen } from "./ui/screen-exchange";
import { LinkScreen } from "./ui/screen-link";
import { Scene } from "./ui/scene";
import { connectDongle, hasWebSerial } from "./utils/webserial";
import {
  GHOST_HEADER_USED_LENGTH,
  GHOST_SIZE,
  ObservedPacket,
  parseGhost,
  TcpObserver,
  WebSerialTransport
} from "@tama-breed-poc/tama-protocol";

// Simple lifecycle: attach the bridge the moment both a dongle and a socket
// are open. Re-clicking Create/Join automatically drops any existing socket.

const state = new StateMachine();
let serial: WebSerialTransport | undefined;
let bridge: SerialBridge | undefined;
let socket: WebSocket | undefined;
let serialOpenPending = false;

const canvas = must<HTMLCanvasElement>("link-canvas");
const scene = new Scene(new Drawer(canvas));
scene.mount();

const exchange = new ExchangeScreen(must("byte-log"), must("ghost-summary"));
new LinkScreen(state).bindState(must("state"));

const outObserver = makeObserver("local", "out");
const inObserver = makeObserver("peer", "in");

function makeObserver(source: "local" | "peer", label: "out" | "in"): TcpObserver {
  return new TcpObserver({
    packet: (p) => handlePacket(source, p),
    command: (line) => {
      console.debug(`[obs ${label}] command`, line);
      exchange.pushSystem(`obs ${label}: ${line}`);
    },
    resync: (reason, total) => {
      console.warn(`[obs ${label}] resync #${total}`, reason);
      exchange.pushSystem(`obs ${label} resync #${total}: ${reason}`);
    }
  });
}

function handlePacket(source: "local" | "peer", packet: ObservedPacket): void {
  console.debug(`[obs ${source}] packet msgType=${packet.msgType} len=${packet.payload.length}`);
  exchange.pushSystem(`packet ${source}: type ${packet.msgType}, ${packet.payload.length} bytes`);

  if (packet.msgType !== 1) {
    console.debug(`[obs ${source}] ignored non-playdate packet (msgType=${packet.msgType})`);
    return;
  }
  if (packet.payload.length < GHOST_HEADER_USED_LENGTH) {
    console.warn(`[obs ${source}] packet too short for a ghost header: ${packet.payload.length}`);
    exchange.pushSystem(`${source}: packet too short to be a ghost (${packet.payload.length} bytes)`);
    return;
  }

  // A live playdate packet is ghost(131072) + play_data(20) = 131092 bytes.
  // Match GhostCapture/GhostCaptureService.cs which truncates to GHOST_SIZE
  // before parsing. The trailing play_data is protocol state we ignore here.
  const ghostBytes = packet.payload.length > GHOST_SIZE ? packet.payload.slice(0, GHOST_SIZE) : packet.payload;

  let parsed;
  try {
    parsed = parseGhost(ghostBytes);
  } catch (error) {
    console.warn(`[obs ${source}] parseGhost threw`, error, headHex(ghostBytes, 64));
    exchange.pushSystem(`${source}: parseGhost failed — ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const preview = toGhostPreview(source, parsed);
  exchange.showGhost(preview);
  console.info(`[compositor] ${source} ghost parsed — chara=${preview.charaId} eye=${preview.eyeCharaId} checksum=${preview.validChecksum}`);

  void composeGhostPreview(preview).then((rendered) => {
    if (rendered) {
      console.info(`[compositor] rendered ${source} ghost ${preview.charaId}`);
      scene.showGhost(source, rendered);
    } else {
      const resolved = resolveBodyId(preview);
      exchange.pushSystem(`${source} ghost parsed (chara ${preview.charaId}) — missing sprite (bodyId ${resolved})`);
    }
  });
}

function headHex(data: Uint8Array, n: number): string {
  return [...data.slice(0, n)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

const portEl = must("port");
const roomEl = must("room");
const bytesInEl = must("bytes-in");
const bytesOutEl = must("bytes-out");
const codeInput = must<HTMLInputElement>("room-code");
const relay = new RelayClient({ baseUrl: config.relayUrl, secret: config.relaySecret });

must<HTMLButtonElement>("connect-serial").addEventListener("click", async () => {
  if (serialOpenPending) return;
  if (serial) await releaseSerial();

  try {
    if (!hasWebSerial()) throw new Error("WebSerial unavailable");
    serialOpenPending = true;
    showAppMessage("Choose your Paradise dongle.");
    serial = await connectDongle();
    portEl.textContent = serial.info.label;
    if (state.current !== "EXCHANGING") state.set("SERIAL_OPEN");
    showAppMessage("Dongle connected.");
    tryAttachBridge();
  } catch (error) {
    showAppError(error);
  } finally {
    serialOpenPending = false;
  }
});

must<HTMLButtonElement>("create-room").addEventListener("click", async () => {
  try {
    await dropExistingSocket();
    const code = await relay.createRoom();
    codeInput.value = code;
    roomEl.textContent = code;
    await connectWs(code, "a");
  } catch (error) {
    showAppError(error);
  }
});

must<HTMLButtonElement>("join-room").addEventListener("click", async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return;
  try {
    await dropExistingSocket();
    roomEl.textContent = code;
    await connectWs(code, "b");
  } catch (error) {
    showAppError(error);
  }
});

async function dropExistingSocket(): Promise<void> {
  if (!socket || socket.readyState >= WebSocket.CLOSING) return;
  const done = new Promise<void>((resolve) => {
    socket!.addEventListener("close", () => resolve(), { once: true });
  });
  socket.close();
  await done;
}

async function connectWs(code: string, role: "a" | "b"): Promise<void> {
  socket = relay.connect(code, role);
  socket.addEventListener("open", () => {
    state.set("WS_OPEN");
    showAppMessage("Room open.");
    tryAttachBridge();
  });
  socket.addEventListener("close", () => {
    closeBridge();
    socket = undefined;
    outObserver.reset();
    inObserver.reset();
    roomEl.textContent = "none";
    bytesInEl.textContent = "0";
    bytesOutEl.textContent = "0";
    state.set(serial ? "SERIAL_OPEN" : "IDLE");
  });
}

function attachBridge(): void {
  if (!serial || !socket) return;
  bridge?.close();
  outObserver.reset();
  inObserver.reset();
  bridge = new SerialBridge(serial, socket, {
    bytes(direction, data, stats) {
      exchange.pushBytes(direction, data);
      const observer = direction === "out" ? outObserver : inObserver;
      observer.push(data);
      bytesInEl.textContent = String(stats.bytesIn);
      bytesOutEl.textContent = String(stats.bytesOut);
      if (state.current !== "EXCHANGING") state.set("EXCHANGING");
    },
    error(error) {
      showAppError(error);
    }
  });
  bridge.start();
  state.set("EXCHANGING");
  showAppMessage("Exchange live. Enter Friend menu on the device.");
}

function tryAttachBridge(): void {
  if (serial && socket?.readyState === WebSocket.OPEN && !bridge) attachBridge();
}

function closeBridge(): void {
  bridge?.close();
  bridge = undefined;
}

async function releaseSerial(): Promise<void> {
  closeBridge();
  const active = serial;
  serial = undefined;
  portEl.textContent = "none";
  await active?.close().catch(() => undefined);
}

function must<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function showAppMessage(message: string): void {
  exchange.showMessage(message);
  scene.setStatus(shortStatus(message));
}

function showAppError(error: unknown): void {
  const message = friendlyError(error);
  exchange.showMessage(message);
  scene.setStatus(shortStatus(message));
}

function shortStatus(message: string): string {
  if (/choose/i.test(message)) return "choose dongle";
  if (/dongle connected/i.test(message)) return "dongle connected";
  if (/room open/i.test(message)) return "room open";
  if (/exchange live/i.test(message)) return "exchange live";
  if (/already open/i.test(message)) return "dongle already open";
  if (/could not open/i.test(message)) return "dongle busy";
  if (/relay/i.test(message) && /room|create/i.test(message)) return "relay unavailable";
  return message.length > 42 ? `${message.slice(0, 39)}...` : message;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/port is already open/i.test(message)) return "That dongle is already open in this tab.";
  if (/failed to open serial port/i.test(message)) return "Could not open the dongle. Close other tabs/apps using it, then try again.";
  if (/WebSerial unavailable/i.test(message)) return "Use Chrome or Edge on localhost to connect the dongle.";
  if (/create room failed/i.test(message)) return "Could not create a room. Check that the relay server is running.";
  return message;
}
