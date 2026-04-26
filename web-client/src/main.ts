import "./ui/styles.css";
import { config } from "./config";
import { composeGhostPreviewFromBin } from "./ghost-compositor";
import { toGhostPreview } from "./ghost-preview";
import { RelayClient } from "./relay-client";
import { SerialBridge } from "./serial-bridge";
import { Drawer } from "./ui/drawer";
import { ExchangeScreen } from "./ui/screen-exchange";
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
// Dongle disconnects (USB unplug) and dead bridges (serial.read failure) both
// funnel into the same recovery path: `releaseSerial()` / `bridge = undefined`,
// which makes the next user click attach cleanly. No browser refresh needed.

let serial: WebSerialTransport | undefined;
let bridge: SerialBridge | undefined;
let socket: WebSocket | undefined;
let currentRoom: string | undefined;
// Last room this tab was actively in; survives WS close so Join Room with
// the same code rejoins in the same role (sticky-rejoin). Cleared/replaced
// when the user explicitly enters a different room or creates a new one.
let lastRoom: string | undefined;
let role: "host" | "guest" | undefined;
let serialOpenPending = false;

const canvas = must<HTMLCanvasElement>("link-canvas");
const scene = new Scene(new Drawer(canvas));
scene.mount();

// Dev hooks: trigger animations from DevTools or via URL query so you can
// preview them without actually running a playdate.
//   window.__previewHearts(n)  -> animate friendship going up to n
//   window.__previewEgg()      -> trigger the egg hatch sequence
//   ?preview=hearts            -> auto-run the heart sweep on load
//   ?preview=egg               -> auto-run the egg hatch on load
//   ?preview=full              -> hearts then egg (full sequence)
declare global {
  interface Window {
    __previewHearts?: (level?: number) => void;
    __previewEgg?: () => void;
  }
}
window.__previewHearts = (level = 4) => {
  scene.setFriendship(0);
  setTimeout(() => scene.setFriendship(level), 50);
};
window.__previewEgg = () => scene.triggerEggHatch();
const params = new URLSearchParams(window.location.search);
const preview = params.get("preview");
if (preview === "hearts" || preview === "full") {
  setTimeout(() => window.__previewHearts!(4), 400);
}
if (preview === "egg" || preview === "full") {
  setTimeout(() => window.__previewEgg!(), preview === "full" ? 1800 : 400);
}

const exchange = new ExchangeScreen(must("byte-log"), must("ghost-summary"));

const outObserver = makeObserver("local", "out");
const inObserver = makeObserver("peer", "in");

// Per-session state across the protocol phases. Once we've seen both sides'
// Phase 1 (ghost + play_data tail) plus the Phase 2 friendship packet, we
// have everything needed to project the post-playdate friendship.
interface SideState { ghost?: ParsedGhost; playData?: PlayData }
const sides: Record<"local" | "peer", SideState> = { local: {}, peer: {} };
let currentFriendship: number | undefined;

function beginSession(): void {
  sides.local = {};
  sides.peer = {};
  currentFriendship = undefined;
  outObserver.reset();
  inObserver.reset();
  scene.beginSession();
}

function makeObserver(source: "local" | "peer", label: "out" | "in"): TcpObserver {
  return new TcpObserver({
    packet: (p) => handlePacket(source, p),
    command: (line) => {
      console.debug(`[obs ${label}] command`, line);
      exchange.pushSystem(`obs ${label}: ${line}`);
      // Surface breeding-phase events on the scene plate too. Only the
      // RECIPIENT sends BREED (per playdate.md §Phase 4); SYNC 2 closes the
      // breeding animation on both sides.
      if (/^BREED\s+1$/i.test(line)) scene.setStatus("breeding...");
      else if (/^BREED\s+0$/i.test(line)) scene.setStatus("breeding declined");
      else if (/^SYNC\s+2$/i.test(line)) {
        scene.setStatus("breeding successful");
        scene.triggerEggHatch();
      }
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
    { stage: peer.stage, charaFlags: peer.charaFlags, hunger: peerPd.friendData.hunger, happiness: peerPd.friendData.happiness, isInLove: peerPd.friendData.isInLove },
    currentFriendship
  );
  scene.setStatus(`expecting: ${prediction.label}${prediction.breedingOffered ? " · breed" : ""}`);
  exchange.pushSystem(
    `prediction: ${prediction.label}${prediction.breedingOffered ? " + breeding offered" : ""}`
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
const activityEl = must("activity");
const bytesInEl = must("bytes-in");
const bytesOutEl = must("bytes-out");

// Last serial-bridge byte timestamp, used to derive Activity = live | idle.
// "live" = a byte was seen within ACTIVITY_LIVE_MS, "idle" = paired but quiet.
let lastByteAt = 0;
const ACTIVITY_LIVE_MS = 2000;
const codeInput = must<HTMLInputElement>("room-code");
const relay = new RelayClient({ baseUrl: config.relayUrl, appName: "playdate-web" });

// USB unplug funnels into the same recovery path as a manual click.
navigator.serial?.addEventListener("disconnect", (event) => {
  if (serial && (event.target as unknown) === (serial.port as unknown)) {
    void releaseSerial();
  }
});

must<HTMLButtonElement>("connect-serial").addEventListener("click", async () => {
  if (serialOpenPending) return;
  if (serial) await releaseSerial();

  try {
    if (!hasWebSerial()) throw new Error("WebSerial unavailable");
    serialOpenPending = true;
    showAppMessage("Choose your Paradise dongle.");
    serial = await connectDongle();
    showAppMessage("Dongle connected.");
    renderHud();
    await attachBridge();
  } catch (error) {
    showAppError(error);
  } finally {
    serialOpenPending = false;
  }
});

must<HTMLButtonElement>("create-room").addEventListener("click", async () => {
  // If we're already in a live room, treat as a no-op. Tearing the socket
  // down to make a new one would kick the peer for no benefit.
  if (socket && socket.readyState === WebSocket.OPEN) {
    showAppMessage("Already in a room. Refresh to start a new one.");
    return;
  }
  try {
    await dropExistingSocket();
    const { code, token } = await relay.createRoom();
    codeInput.value = code;
    currentRoom = code;
    lastRoom = code;
    role = "host";
    await connectWs(code, "a", token);
  } catch (error) {
    showAppError(error);
  }
});

must<HTMLButtonElement>("join-room").addEventListener("click", async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!code) return;
  // If we're already live in this exact room, the click is accidental —
  // don't tear down our own socket (which the relay reads as us leaving and
  // kicks the peer with "peer closed").
  if (socket && socket.readyState === WebSocket.OPEN && currentRoom === code) {
    showAppMessage(`Already in room ${code}.`);
    return;
  }
  try {
    await dropExistingSocket();
    // Sticky-rejoin only when the code matches the last room we were in.
    // A different code means the user is intentionally entering someone
    // else's room, so default to guest regardless of any prior host role.
    if (code !== lastRoom) role = "guest";
    currentRoom = code;
    lastRoom = code;
    const wsRole = role === "host" ? "a" : "b";
    // Knowing the 6-char code is the gate to fetch the token. Server
    // returns the same token across repeated calls (idempotent), so a
    // sticky-rejoin after a peer-refresh kick re-auths cleanly without
    // ever asking the user for more than the room code.
    const token = await relay.fetchToken(code);
    await connectWs(code, wsRole, token);
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

async function connectWs(code: string, wsRole: "a" | "b", token: string): Promise<void> {
  const ws = relay.connect(code, wsRole, token);
  socket = ws;
  // Capture the socket reference so a stale close event from a previously
  // dropped socket can't clobber a freshly assigned one (Bug 3a).
  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    showAppMessage("Room open.");
    renderHud();
    void attachBridge();
  });
  ws.addEventListener("close", () => {
    if (socket !== ws) return;
    bridge?.stop();
    bridge = undefined;
    socket = undefined;
    // Capture the room we were in before clearing live state, so Join Room
    // with the same code can recognise a rejoin and keep the same role.
    lastRoom = currentRoom;
    currentRoom = undefined;
    bytesInEl.textContent = "0";
    bytesOutEl.textContent = "0";
    beginSession();
    renderHud();
  });
}

async function attachBridge(): Promise<void> {
  if (!serial || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (bridge && !bridge.isClosed) return;
  bridge?.stop();
  bridge = undefined;
  beginSession();
  bridge = new SerialBridge(serial, socket, {
    bytes(direction, data, stats) {
      exchange.pushBytes(direction, data);
      const observer = direction === "out" ? outObserver : inObserver;
      observer.push(data);
      bytesInEl.textContent = String(stats.bytesIn);
      bytesOutEl.textContent = String(stats.bytesOut);
      lastByteAt = performance.now();
    },
    error(error) {
      // Bridge owns its own death — clearing the reference here is what
      // lets the next user click re-attach without a refresh. Also close
      // the WS so the peer's observer gets a clean reset instead of
      // sitting on a stale partial packet (their ws.close handler runs
      // beginSession on their side).
      bridge = undefined;
      socket?.close();
      renderHud();
      showAppError(error);
    }
  });
  bridge.start();
  showAppMessage("Exchange live. Enter Friend menu on the device.");
}

async function releaseSerial(): Promise<void> {
  if (!serial) return;
  const dyingSerial = serial;
  bridge?.stop();
  bridge = undefined;
  serial = undefined;
  // Close the WS too so the relay kicks the peer (4000 'peer closed').
  // Their ws.close handler runs beginSession() on that side, which resets
  // their observers — preventing the stale-partial-packet buffer that
  // would otherwise corrupt the next session for them.
  socket?.close();
  renderHud();
  await dyingSerial.close().catch(() => undefined);
}

/**
 * Single source of truth for the connection HUD. Reads the (serial, socket,
 * role) triple and writes Dongle / Room / Role together. Called from every
 * state-mutating handler so the HUD never lies.
 */
function renderHud(): void {
  portEl.textContent = serial ? "connected" : "disconnected";
  const isRoomLive = !!socket && socket.readyState <= WebSocket.OPEN;
  roomEl.textContent = isRoomLive && currentRoom ? currentRoom : "none";
  roleEl.textContent = isRoomLive && role ? role : "—";
  const paired = !!serial && isRoomLive;
  if (!paired) activityEl.textContent = "—";
  else activityEl.textContent = (performance.now() - lastByteAt) < ACTIVITY_LIVE_MS ? "live" : "idle";
}

renderHud();
// Activity flips back to "idle" after silence — needs a low-rate tick because
// the event-driven renderHud calls only fire on state changes, not on the
// passage of time. 1Hz is well below any noticeable cost (one DOM textContent
// per second, ~microseconds of CPU, no GC pressure).
setInterval(renderHud, 1000);

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
  if (/no port selected/i.test(message)) return "No dongle selected.";
  if (/port is already open/i.test(message)) return "That dongle is already open in this tab.";
  if (/failed to open serial port/i.test(message)) return "Could not open the dongle. Close other tabs/apps using it, then try again.";
  if (/WebSerial unavailable/i.test(message)) return "Use Chrome or Edge on localhost to connect the dongle.";
  if (/create room failed/i.test(message)) return "Could not create a room. Check that the relay server is running.";
  return message;
}
