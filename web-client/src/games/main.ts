import "./style.css";
import { GameRoom } from "./game-room";
import { requestParadiseSerialPort, UartConnectionError, type WebSerialTransport } from "@tama-breed-poc/tama-protocol";
import { games, gameId } from "./catalog";
import { GameInstallService, isInstallAsset, isMusicAssets, type InstallAsset, type MusicAssets, type InstallProgress } from "../game-install-service";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connect = element<HTMLButtonElement>("connect");
const gameSelect = element<HTMLSelectElement>("game");
gameSelect.value = gameId(new URL(location.href).searchParams.get("game") ?? document.body.dataset.defaultGame ?? null);
let selectedGame = games[gameId(gameSelect.value)];
let serial: WebSerialTransport | undefined;
let busy = false;
let room: GameRoom | undefined;
let gameAsset: InstallAsset | undefined, musicAssets: MusicAssets | undefined;
let transferring = false;
const installer = new GameInstallService(new URL("./", location.href));
const musicButton = element<HTMLButtonElement>("install-music"), sendButton = element<HTMLButtonElement>("send-game");
const lines: string[] = [];
function status(text: string) { element("status").textContent = text; }
function controls() {
  gameSelect.disabled = Boolean(serial || busy || room?.active);
  connect.disabled = busy; connect.textContent = serial ? "Disconnect" : "Connect Paradise";
  element("device-state").textContent = serial ? "Connected" : "Not connected";
  sendButton.disabled = !serial || busy || !!room?.active || !gameAsset;
  musicButton.disabled = !serial || busy || !!room?.active || !musicAssets;
  for (const id of ["install-actions", "install-instruction", "game-download-status", "existing-game-hint"])
    element(id).hidden = !!room?.active;
  room?.update();
}
function log(text: string) {
  lines.push(text); if (lines.length > 40) lines.shift(); element("log").textContent = lines.join("\n");
}
async function disconnect(message: string) {
  room?.releaseAdapter();
  const previous = serial; serial = undefined;
  await previous?.close();
  status(message); controls();
}
async function run(action: () => Promise<void>) {
  if (busy) return; busy = true; controls();
  try { await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed. Try again.";
    // A mistyped/expired room does not invalidate a healthy USB connection.
    status(message);
  }
  finally { busy = false; controls(); }
}
connect.addEventListener("click", () => void run(async () => {
  if (serial) return disconnect("Disconnected. You can reconnect when ready.");
  const selected = await requestParadiseSerialPort();
  try { await selected.open({ baudRate: 460800 }); }
  catch (error) { await selected.close(); throw error; }
  serial = selected; room?.adapterConnected(); status("Connected. Keep this page open while you play.");
}));
window.addEventListener("pagehide", () => { room?.close(); void serial?.close(); });
function installProgress(value: InstallProgress) {
  element("install-progress").hidden = false;
  element("install-status").textContent = value.phase;
  const bar = element<HTMLProgressElement>("transfer-progress");
  bar.hidden = false;
  if (value.total === undefined) bar.removeAttribute("value");
  else { bar.max = value.total; bar.value = value.done ?? 0; }
}
async function install(kind: "music" | "game") {
  if (!serial || room?.active) return;
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
  gameAsset = undefined; musicAssets = undefined;
  element("game-name").textContent = selectedGame.title;
  element("game-controls").textContent = selectedGame.controls;
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
    if ("music" in data && isMusicAssets(data.music)) musicAssets = data.music;
    element("music-setup").hidden = !musicAssets;
    element("game-download-status").textContent = "";
  } catch (error) {
    if (chosen === selectedGame) element("game-download-status").textContent = error instanceof SyntaxError ? "Game files could not be loaded. Refresh to try again." : error instanceof Error ? error.message : "Could not load game files.";
  } finally { controls(); }
}
gameSelect.addEventListener("change", () => {
  if (serial || busy || room?.active) return;
  const url = new URL(location.href); url.searchParams.set("game", gameId(gameSelect.value));
  history.replaceState(null, "", url); void selectGame(); room?.gameChanged();
});
room = new GameRoom(import.meta.env.VITE_RELAY_URL ?? location.origin, {
  serial: () => serial, game: () => gameSelect.value, busy: () => busy, changed: controls,
  adapterLost: () => { void disconnect("Adapter connection lost. Reconnect your Paradise."); }
});
controls(); void selectGame(); void room.initialize();
