import "./ui/styles.css";
import { mountStockShell } from "./ui/stock-shell";
import { mountStockLink, must } from "./stock-link";
import { config } from "./config";
import { composeGhostPreviewFromBin } from "./ghost-compositor";
import { toGhostPreview } from "./ghost-preview";
import { Drawer } from "./ui/drawer";
import { ExchangeScreen } from "./ui/screen-exchange";
import { Scene } from "./ui/scene";
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
  TcpObserver
} from "@tama-breed-poc/tama-protocol";

mountStockShell("playdate");

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
exchange.pushSystem("Page opened; timestamped connection diagnostics v1. In = peer bytes written to adapter; out = adapter bytes sent to room. These are not proof the toy accepted them.");
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
  exchange.reset();
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
        scene.setStatus("breeding animation sync observed");
        // SYNC is an animation rendezvous, not evidence an egg was saved.
      }
    },
    resync: (reason, total) => {
      console.warn(`[obs ${label}] resync #${total}`, reason);
      exchange.pushSystem(`Preview decoder ${label} resync #${total}: ${reason}. Passive warning; forwarded bytes are unchanged.`);
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


mountStockLink("playdate", config.relayUrl, scene, exchange, outObserver, inObserver, beginSession);
