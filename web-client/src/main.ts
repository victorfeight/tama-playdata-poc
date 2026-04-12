import "./ui/styles.css";
import { config } from "./config";
import { composeGhostPreviewFromBin } from "./ghost-compositor";
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
  decodePlayData,
  GHOST_HEADER_USED_LENGTH,
  GHOST_SIZE,
  MSG_FLAG_SET_SESSION_ID,
  ObservedPacket,
  ParsedGhost,
  PlayData,
  PLAY_DATA_LENGTH,
  parseGhost,
  predictPlayType,
  projectFriendship,
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

// Per-session state across the protocol phases. Once we've seen both sides'
// Phase 1 (ghost + play_data tail) plus the Phase 2 friendship packet, we
// have everything needed to project the post-playdate friendship.
interface SideState { ghost?: ParsedGhost; playData?: PlayData }
const sides: Record<"local" | "peer", SideState> = { local: {}, peer: {} };
let currentFriendship: number | undefined;

function resetSessionState(): void {
  sides.local = {};
  sides.peer = {};
  currentFriendship = undefined;
}

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

  // Session-ID setter: 2 random bytes sent at the start of a session. Not a
  // friendship update. Skip so we don't display garbage values.
  if ((packet.rawMsgType & MSG_FLAG_SET_SESSION_ID) !== 0) {
    exchange.pushSystem(`${source}: session id set (${packet.payload.length} bytes)`);
    return;
  }

  // Short msgType=1 payloads are the playdate-protocol control packets:
  //   2 bytes = friendship update (u16)
  //   4 bytes = play result { result u16, can_breed u16 } per playdate.md §Phase 3
  // Surface these in the bottom plate so the user sees what actually happened
  // (fought, ate, played, breeding offered).
  if (packet.payload.length === 2) {
    // Phase 2 friendship exchange — pre-playdate value from the peer's record.
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength);
    const friendship = view.getUint16(0, true);
    currentFriendship = friendship;
    scene.setFriendship(friendship);
    scene.setStatus(`friendship: ${friendship}/4`);
    exchange.pushSystem(`${source}: friendship update = ${friendship}`);
    maybePredictPreResult();
    return;
  }
  if (packet.payload.length === 4) {
    // Phase 3 play result — final answer from the initiator. Now we know the
    // actual play_type and can project post-playdate friendship locally.
    const view = new DataView(packet.payload.buffer, packet.payload.byteOffset, packet.payload.byteLength);
    const result = view.getUint16(0, true);
    const canBreed = view.getUint16(2, true) & 1;
    const label = playResultLabel(result);
    const breed = canBreed ? " · breeding available" : "";
    scene.setStatus(`result: ${label}${breed}`);
    exchange.pushSystem(`${source}: play result ${result} (${label})${canBreed ? ", can_breed=1" : ""}`);
    projectAndShowFinalFriendship(result);
    return;
  }

  if (packet.payload.length < GHOST_HEADER_USED_LENGTH) {
    console.warn(`[obs ${source}] short packet, unknown format: ${packet.payload.length}`);
    exchange.pushSystem(`${source}: unknown short packet (${packet.payload.length} bytes)`);
    return;
  }

  // A live playdate packet is ghost(131072) + play_data(20) = 131092 bytes per
  // protocols/playdate.md §Phase 1. Parse the ghost (header + sprites) AND the
  // trailing play_data; the latter carries hunger/happiness/is_in_love that
  // drive play-type prediction and post-playdate friendship projection.
  const ghostBytes = packet.payload.length > GHOST_SIZE ? packet.payload.slice(0, GHOST_SIZE) : packet.payload;

  let parsed;
  try {
    parsed = parseGhost(ghostBytes);
  } catch (error) {
    console.warn(`[obs ${source}] parseGhost threw`, error, headHex(ghostBytes, 64));
    exchange.pushSystem(`${source}: parseGhost failed — ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  sides[source].ghost = parsed;

  // Trailing play_data, when present.
  if (packet.payload.length >= GHOST_SIZE + PLAY_DATA_LENGTH) {
    try {
      const playDataBytes = packet.payload.slice(GHOST_SIZE, GHOST_SIZE + PLAY_DATA_LENGTH);
      const playData = decodePlayData(playDataBytes);
      sides[source].playData = playData;
      const f = playData.friendData;
      exchange.pushSystem(
        `${source}: play_data — hunger ${f.hunger}/6, happiness ${f.happiness}/20, love ${f.isInLove ? "yes" : "no"}`
      );
    } catch (error) {
      console.warn(`[obs ${source}] decodePlayData threw`, error);
    }
  }

  const preview = toGhostPreview(source, parsed);
  exchange.showGhost(preview);
  console.info(`[compositor] ${source} ghost parsed — chara=${preview.charaId} eye=${preview.eyeCharaId} checksum=${preview.validChecksum}`);

  // TRUE bin rendering: draw the sprite pixels the Paradise actually sent,
  // not a PNG looked up by charaId. Handles bred/jade/custom/meowtchi variants
  // correctly because we paint the bytes on the wire.
  const rendered = composeGhostPreviewFromBin(source, ghostBytes);
  if (rendered) {
    console.info(`[compositor] rendered ${source} ghost ${preview.charaId}`);
    scene.showGhost(source, rendered);
  } else {
    exchange.pushSystem(`${source} ghost parsed (chara ${preview.charaId}) — sprite bytes didn't render`);
  }

  maybePredictPreResult();
}

// Emit a single short prediction line once we have both sides' inputs AND the
// Phase 2 friendship. Shown BEFORE the Phase 3 result arrives; once the real
// result lands, projectAndShowFinalFriendship() supersedes this line.
function maybePredictPreResult(): void {
  const local = sides.local.ghost;
  const peer = sides.peer.ghost;
  const localPd = sides.local.playData;
  const peerPd = sides.peer.playData;
  if (!local || !peer || !localPd || !peerPd) return;

  const prediction = predictPlayType(
    { stage: local.stage, charaFlags: local.charaFlags, hunger: localPd.friendData.hunger, happiness: localPd.friendData.happiness, isInLove: localPd.friendData.isInLove },
    { stage: peer.stage, charaFlags: peer.charaFlags, hunger: peerPd.friendData.hunger, happiness: peerPd.friendData.happiness, isInLove: peerPd.friendData.isInLove }
  );
  scene.setStatus(`expecting: ${prediction.label}${prediction.breedingOffered ? " · breed?" : ""}`);
  exchange.pushSystem(
    `prediction: ${prediction.label}${prediction.breedingOffered ? " (breeding may be offered)" : ""}`
  );
}

function projectAndShowFinalFriendship(resultCode: number): void {
  if (currentFriendship === undefined) return;
  const localPd = sides.local.playData;
  const peerPd = sides.peer.playData;
  const local = localPd?.friendData.isInLove ?? false;
  const peer = peerPd?.friendData.isInLove ?? false;
  const projected = projectFriendship(currentFriendship, resultCode, local, peer);
  scene.setFriendship(projected);
  if (projected !== currentFriendship) {
    scene.setStatus(`friendship ${currentFriendship} → ${projected}`);
    exchange.pushSystem(`projected post-playdate friendship: ${currentFriendship} → ${projected}/4`);
  } else {
    exchange.pushSystem(`projected post-playdate friendship: unchanged at ${projected}/4`);
  }
}

function headHex(data: Uint8Array, n: number): string {
  return [...data.slice(0, n)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function playResultLabel(code: number): string {
  // Per tama-para-research/protocols/playdate.md §Phase 3
  switch (code) {
    case 0: return "played";
    case 1: return "fought";
    case 2: return "ate peer";
    case 3: return "eaten by peer";
    case 4: return "breeding";
    default: return `unknown (${code})`;
  }
}

const portEl = must("port");
const roomEl = must("room");
const roleEl = must("role");
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
    roleEl.textContent = "host (A)";
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
    roleEl.textContent = "guest (B)";
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
    resetSessionState();
    roomEl.textContent = "none";
    roleEl.textContent = "—";
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
  resetSessionState();
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
