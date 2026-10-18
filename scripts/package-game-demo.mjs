// Local-only staging. Existing destinations are refused; no upload/deploy.
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
const fullWeb = process.argv.slice(3).includes("--full-web");
const setupArg = process.argv.slice(3).find(arg => arg.startsWith("--music-setup="));
const streamArg = process.argv.slice(3).find(arg => arg.startsWith("--music-stream="));
const removeArg = process.argv.slice(3).find(arg => arg.startsWith("--music-remover="));
const payloadReceipts = process.argv.slice(3).filter(arg => arg !== "--full-web" && arg !== setupArg && arg !== streamArg && arg !== removeArg);
if (!output) throw new Error("Usage: node scripts/package-game-demo.mjs /new/staging-directory [source-app-build.json ...]");
const destination = path.resolve(output), dist = path.join(root, "web-client/dist");
const html = await readFile(path.join(dist, "games/index.html"), "utf8");
if (!html.includes("/assets/")) throw new Error("Build the production web entry first");
// Resolve provenance before creating output so a Git failure leaves no partial package.
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
const payloads = [];
for (const payloadReceipt of payloadReceipts) {
  const receipt = JSON.parse(await readFile(payloadReceipt, "utf8"));
  const names = { "tetris-versus": "blocks", "pocket-puzzle": "pocket-puzzle" };
  const name = names[receipt.application];
  if (!name || receipt.route !== "source-fud1" ||
      receipt.source_only_expected !== true) throw new Error("Expected a supported source game app-build.json receipt");
  if (payloads.some(p => p.manifest.application === receipt.application)) throw new Error("Duplicate game receipt");
  const bytes = await readFile(receipt.payload);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== receipt.payload_sha256) throw new Error("Payload does not match its source build receipt");
  const buildBytes = await readFile(receipt.build_receipt);
  if (createHash("sha256").update(buildBytes).digest("hex") !== receipt.build_receipt_sha256)
    throw new Error("Underlying source receipt hash mismatch");
  const build = JSON.parse(buildBytes);
  if (build.source_only !== true || build.payload_sha256 !== sha256 || build.game !== receipt.application)
    throw new Error("Underlying build does not establish a matching source-only payload");
  payloads.push({ bytes, manifestName: name === "blocks" ? "payload.json" : "payload-pocket-puzzle.json",
    manifest: { file: `${name}.${sha256.slice(0, 12)}.pdlo.bin`, sha256, bytes: bytes.length,
    application: receipt.application, hardwareQualified: receipt.hardware_qualified === true,
    sourceBuildReceiptSha256: receipt.build_receipt_sha256 } });
}
if (fullWeb && payloads.length !== 2) throw new Error("A full web release needs verified Blocks and Pocket Puzzle receipts");
let setup;
if (setupArg) {
  const archive = setupArg.slice("--music-setup=".length);
  if (!archive.endsWith(".zip")) throw new Error("Expected music setup ZIP");
  const receipt = JSON.parse(await readFile(archive.slice(0, -4) + ".json", "utf8"));
  const bytes = await readFile(archive), sha256 = createHash("sha256").update(bytes).digest("hex");
  const puzzle = payloads.find(p => p.manifest.application === "pocket-puzzle");
  if (!puzzle || receipt.operation !== "install-only" || receipt.sha256 !== sha256 || receipt.game_sha256 !== puzzle.manifest.sha256)
    throw new Error("Music setup receipt or bundled game differs from release");
  setup = { bytes, file: `pocket-puzzle-setup.${sha256.slice(0, 12)}.zip`, sha256 };
  puzzle.manifest.setup = { file: setup.file, sha256 };
}
const musicFiles = [];
let musicBankSha;
if (streamArg) {
  const directory = streamArg.slice("--music-stream=".length);
  const receipt = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  musicBankSha = receipt.bank_sha256;
  const puzzle = payloads.find(p => p.manifest.application === "pocket-puzzle");
  if (!puzzle || receipt.operation !== "install-only" || receipt.protocol_profile !== "puzzle-music" ||
      !Number.isInteger(receipt.sectors) || receipt.sectors < 1 || receipt.sectors > 256 ||
      JSON.stringify(receipt.protected_range) !== "[0,15728640]") throw new Error("Expected reviewed music-only stream package");
  const music = { profile: receipt.protocol_profile, sectors: receipt.sectors };
  for (const [key, input, label] of [["bootstrap", "bootstrap.pdlo.bin", "helper"], ["bundle", "media.tpfw.bin", "bundle"]]) {
    const bytes = await readFile(path.join(directory, input));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== receipt[`${key}_sha256`] || bytes.length !== receipt[`${key}_bytes`]) throw new Error(`Music ${label} differs from reviewed receipt`);
    if (key === "bootstrap" && bytes.length !== 65532) throw new Error("Invalid music helper size");
    if (key === "bundle" && bytes.length !== 128 + receipt.sectors * 4132) throw new Error("Invalid music stream size");
    const file = `music-${label}.${sha256.slice(0, 12)}.bin`;
    music[label] = { file, sha256, bytes: bytes.length };
    musicFiles.push({ file, bytes });
  }
  puzzle.manifest.music = music;
}
if (removeArg) {
  const directory = removeArg.slice("--music-remover=".length);
  const receipt = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const puzzle = payloads.find(p => p.manifest.application === "pocket-puzzle");
  if (!puzzle?.manifest.music || receipt.operation !== "remove-only" || receipt.protocol_profile !== "puzzle-clear-v1" ||
      receipt.sectors !== 256 || receipt.bank_sha256 !== musicBankSha || JSON.stringify(receipt.protected_range) !== "[0,15728640]" ||
      !Number.isInteger(receipt.bank_crc32) || receipt.bank_crc32 < 0 || receipt.bank_crc32 > 0xffffffff) throw new Error("Invalid or mismatched music remover contract");
  const bytes = await readFile(path.join(directory, "bootstrap.pdlo.bin"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== 65532 || receipt.bootstrap_bytes !== bytes.length || receipt.bootstrap_sha256 !== sha256) throw new Error("Music remover differs from receipt");
  const file = `music-remover.${sha256.slice(0, 12)}.bin`;
  puzzle.manifest.music.removal = { helper: { file, sha256, bytes: bytes.length }, bankCrc32: receipt.bank_crc32, sectors: 256 };
  musicFiles.push({ file, bytes });
}
if (fullWeb && !streamArg) throw new Error("Full web releases require --music-stream so browser music installation is included");
if (fullWeb && !removeArg) throw new Error("Full web releases require --music-remover so installed music can be removed");
await mkdir(destination); // Exclusive destination: do not overwrite another release.
for (const name of fullWeb ? ["games", "gifts", "assets", "sprites", "index.html"] : ["games", "assets"])
  await cp(path.join(dist, name), path.join(destination, name), { recursive: true });
for (const payload of payloads) {
  await writeFile(path.join(destination, "games", payload.manifest.file), payload.bytes);
  await writeFile(path.join(destination, "games", payload.manifestName), JSON.stringify(payload.manifest, null, 2) + "\n");
}
if (setup) await writeFile(path.join(destination, "games", setup.file), setup.bytes);
for (const music of musicFiles) await writeFile(path.join(destination, "games", music.file), music.bytes);
const files = {};
async function scan(dir) {
  for (const entry of await readdir(path.join(destination, dir), { withFileTypes: true })) {
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await scan(name);
    else files[name] = createHash("sha256").update(await readFile(path.join(destination, name))).digest("hex");
  }
}
await scan("");
await writeFile(path.join(destination, "manifest.json"), JSON.stringify({ sourceCommit, dirty, fullWeb, files }, null, 2) + "\n");
console.log(`Staged ${Object.keys(files).length} files at ${destination}; source ${sourceCommit}${dirty ? " (uncommitted changes)" : ""}. Not deployed.`);
