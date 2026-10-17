import "./style.css";
import { HostedGameRoom } from "./hosted-room";
import { requestParadiseSerialPort, UartConnectionError, type WebSerialTransport } from "@tama-breed-poc/tama-protocol";
import { RelayClient } from "../relay-client";
import { SerialBridge } from "../serial-bridge";
import { Tet3Observer, type Tet3Packet } from "./tet3";
import { games, gameId } from "./catalog";
import { GameInstallService, isInstallAsset, isMusicAssets, type InstallAsset, type MusicAssets, type InstallProgress } from "../game-install-service";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connect = element<HTMLButtonElement>("connect"), create = element<HTMLButtonElement>("create");
const join = element<HTMLButtonElement>("join"), code = element<HTMLInputElement>("code");
const gameSelect = element<HTMLSelectElement>("game");
gameSelect.value = gameId(new URL(location.href).searchParams.get("game") ?? document.body.dataset.defaultGame ?? null);
let selectedGame = games[gameId(gameSelect.value)];
const makeRelay = () => new RelayClient({ baseUrl: import.meta.env.VITE_RELAY_URL ?? location.origin,
  appName: selectedGame.app, expectedApp: selectedGame.app });
let relay = makeRelay();
const observers = { in: new Tet3Observer(), out: new Tet3Observer() };
let serial: WebSerialTransport | undefined, socket: WebSocket | undefined, bridge: SerialBridge | undefined;
let busy = false, generation = 0;
let hosted: HostedGameRoom | undefined;
let gameAsset: InstallAsset | undefined, musicAssets: MusicAssets | undefined;
let transferring = false;
const installer = new GameInstallService(new URL("./", location.href));
const musicButton = element<HTMLButtonElement>("install-music"), sendButton = element<HTMLButtonElement>("send-game");
let player: number | undefined, currentRound = 0;
const lines: string[] = [];
function status(text: string) { element("status").textContent = text; }
function controls() {
  gameSelect.disabled = Boolean(serial || socket || busy || hosted?.active);
  connect.disabled = busy; connect.textContent = serial ? "Disconnect" : "Connect Paradise";
  create.disabled = join.disabled = !serial || busy || Boolean(socket) || !!hosted?.active || !!hosted?.selected;
  code.disabled = busy || Boolean(socket);
  element<HTMLButtonElement>("leave").disabled = busy;
  element("device-state").textContent = serial ? "Connected" : "Not connected";
  sendButton.disabled = !serial || busy || !!socket || !!hosted?.active || !gameAsset;
  musicButton.disabled = !serial || busy || !!socket || !!hosted?.active || !musicAssets;
  const inRoom = !!socket || !!hosted?.active;
  for (const id of ["install-actions", "install-instruction", "game-download-status", "existing-game-hint"]) element(id).hidden = inRoom;
  element("download").hidden = inRoom || !gameAsset;
  hosted?.update();
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
  hosted?.releaseAdapter();
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
  serial = selected; status("Connected. Send the game above, or join a room if it’s already on your toy.");
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
window.addEventListener("pagehide", () => { hosted?.close(); bridge?.stop(); socket?.close(); void serial?.close(); });
function installProgress(value: InstallProgress) {
  element("install-progress").hidden = false;
  element("install-status").textContent = value.phase;
  const bar = element<HTMLProgressElement>("transfer-progress");
  bar.hidden = false;
  if (value.total === undefined) bar.removeAttribute("value");
  else { bar.max = value.total; bar.value = value.done ?? 0; }
}
async function install(kind: "music" | "game") {
  if (!serial || socket || hosted?.active) return;
  transferring = true;
  try {
    if (kind === "music") {
      if (!musicAssets) throw new Error("Music files are not available yet.");
      const result = await installer.installMusic(serial, musicAssets, installProgress);
      log(`Music verified: ${result.written} sectors written, ${result.matched} already matched.`);
      element("install-status").textContent = "Music verified. Press C on your toy to return home, then open Connection → Download → Download and click Send game. Keep the adapter connected.";
      element("install-instruction").textContent = "Next: press C to return home, reopen Download, then send the game below.";
    } else {
      if (!gameAsset) throw new Error("The game download is not available yet.");
      await installer.sendGame(serial, gameAsset, installProgress);
      element("install-status").textContent = "Game received. Wait for its main menu, then create or join a room below. Keep this connection open.";
      element("install-instruction").textContent = "Your game is sent. Keep it on its main menu until your friend joins.";
      status("Ready to meet a friend. Create a room or enter their code below.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer stopped. Check the toy before retrying.";
    element("install-progress").hidden = false;
    element("install-status").textContent = message;
    status(message);
    if (error instanceof UartConnectionError) await disconnect(message);
  } finally { transferring = false; element("transfer-progress").hidden = true; }
}
musicButton.addEventListener("click", () => void run(() => install("music")));
sendButton.addEventListener("click", () => void run(() => install("game")));
window.addEventListener("beforeunload", event => {
  if (transferring) { event.preventDefault(); event.returnValue = ""; }
});
async function selectGame() {
  selectedGame = games[gameId(gameSelect.value)];
  relay = makeRelay(); gameAsset = undefined; musicAssets = undefined;
  element("game-name").textContent = selectedGame.title;
  element("game-controls").textContent = selectedGame.controls;
  element("download").hidden = true;
  element("music-setup").hidden = gameSelect.value !== "pocket-puzzle";
  element("install-progress").hidden = true;
  element("game-download-status").textContent = "Checking game availability…";
  controls();
  const chosen = selectedGame;
  const manifest = gameSelect.value === "blocks" ? "payload.json" : "payload-pocket-puzzle.json";
  try {
    const local = document.getElementById("local-payloads");
    let data: unknown;
    if (local) data = JSON.parse(local.textContent ?? "{}")[manifest];
    else {
      const response = await fetch(`./${manifest}`);
      if (!response.ok) throw new Error("Game files are unavailable. Refresh to try again.");
      data = await response.json();
    }
    if (chosen !== selectedGame) return;
    if (!isInstallAsset(data) || data.bytes > 65536 || !chosen.payloadPattern.test(data.file) ||
        !("application" in data) || data.application !== chosen.application) throw new Error("Game package needs updating. Refresh to try again.");
    gameAsset = data;
    const link = element<HTMLAnchorElement>("payload-link");
    link.href = `./${data.file}`; link.textContent = `Download ${chosen.title}`;
    link.title = `SHA-256: ${data.sha256}`; element("download").hidden = false;
    if ("music" in data && isMusicAssets(data.music)) musicAssets = data.music;
    element("music-setup").hidden = !musicAssets;
    element("game-download-status").textContent = "";
  } catch (error) {
    if (chosen === selectedGame) element("game-download-status").textContent = error instanceof SyntaxError ? "Game files could not be loaded. Refresh to try again." : error instanceof Error ? error.message : "Could not load game files.";
  } finally { controls(); }
}
gameSelect.addEventListener("change", () => {
  if (serial || socket || busy || hosted?.active) return;
  const url = new URL(location.href); url.searchParams.set("game", gameId(gameSelect.value));
  history.replaceState(null, "", url); void selectGame();
});
hosted = new HostedGameRoom(import.meta.env.VITE_RELAY_URL ?? location.origin, {
  serial: () => serial, game: () => gameSelect.value, busy: () => busy || !!socket, changed: controls
});
controls(); void selectGame(); void hosted.initialize();
// Optional staging manifest: the package builder verifies the source receipt
// before including a payload. Missing manifest simply leaves manual send intact.
