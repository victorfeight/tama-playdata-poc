import "./ui/styles.css";
import { config } from "./config";
import { composeGhostPreview } from "./ghost-compositor";
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
  parseGhost,
  TcpObserver,
  WebSerialTransport
} from "@tama-breed-poc/tama-protocol";

// Simple lifecycle: attach the bridge the moment both a dongle and a socket
// are open. If the peer hasn't joined yet the relay will drop our outgoing
// bytes (Paradise retransmits, so that's fine). This matches the original
// behavior that worked first-try before the paired-signal gate was added.

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

const outObserver = new TcpObserver({ packet: (p) => handlePacket("local", p) });
const inObserver = new TcpObserver({ packet: (p) => handlePacket("peer", p) });

function handlePacket(source: "local" | "peer", packet: { msgType: number; payload: Uint8Array }): void {
  if (packet.msgType !== 1) return;
  if (packet.payload.length < GHOST_HEADER_USED_LENGTH) return;
  let parsed;
  try {
    parsed = parseGhost(packet.payload);
  } catch {
    return;
  }
  const preview = toGhostPreview(source, parsed);
  exchange.showGhost(preview);
  void composeGhostPreview(preview).then((rendered) => {
    if (rendered) scene.showGhost(source, rendered);
  });
}

const portEl = must("port");
const roomEl = must("room");
const bytesInEl = must("bytes-in");
const bytesOutEl = must("bytes-out");
const codeInput = must<HTMLInputElement>("room-code");
const cancelButton = must<HTMLButtonElement>("cancel");
const relay = new RelayClient({ baseUrl: config.relayUrl, secret: config.relaySecret });

refreshControls();

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
    refreshControls();
  }
});

must<HTMLButtonElement>("create-room").addEventListener("click", async () => {
  try {
    const code = await relay.createRoom();
    codeInput.value = code;
    roomEl.textContent = code;
    await connectWs(code, "a");
  } catch (error) {
    showAppError(error);
  } finally {
    refreshControls();
  }
});

must<HTMLButtonElement>("join-room").addEventListener("click", async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return;
  roomEl.textContent = code;
  try {
    await connectWs(code, "b");
  } catch (error) {
    showAppError(error);
  } finally {
    refreshControls();
  }
});

cancelButton.addEventListener("click", () => {
  void cancelRoom("Exchange cancelled. Dongle still connected.");
});

async function connectWs(code: string, role: "a" | "b"): Promise<void> {
  if (socket && socket.readyState < WebSocket.CLOSING) {
    showAppMessage("Room is already connected.");
    return;
  }

  socket = relay.connect(code, role);
  socket.addEventListener("open", () => {
    state.set("WS_OPEN");
    showAppMessage("Room open.");
    tryAttachBridge();
    refreshControls();
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
    refreshControls();
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
  refreshControls();
}

function tryAttachBridge(): void {
  if (serial && socket?.readyState === WebSocket.OPEN && !bridge) attachBridge();
}

function closeBridge(): void {
  bridge?.close();
  bridge = undefined;
}

async function cancelRoom(message: string): Promise<void> {
  socket?.close();
  if (!socket) {
    closeBridge();
    outObserver.reset();
    inObserver.reset();
    roomEl.textContent = "none";
    bytesInEl.textContent = "0";
    bytesOutEl.textContent = "0";
    state.set(serial ? "SERIAL_OPEN" : "IDLE");
    refreshControls();
  }
  showAppMessage(message);
}

async function releaseSerial(): Promise<void> {
  closeBridge();
  const active = serial;
  serial = undefined;
  portEl.textContent = "none";
  await active?.close().catch(() => undefined);
}

function refreshControls(): void {
  const roomActive = Boolean(socket) && socket!.readyState < WebSocket.CLOSING;
  cancelButton.hidden = !roomActive;
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
  if (/cancelled/i.test(message)) return "cancelled";
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
