// Local-only staging. Existing destinations are refused; no upload/deploy.
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
const payloadReceipt = process.argv[3];
if (!output) throw new Error("Usage: node scripts/package-game-demo.mjs /new/staging-directory [source-app-build.json]");
const destination = path.resolve(output), dist = path.join(root, "web-client/dist");
const html = await readFile(path.join(dist, "games/index.html"), "utf8");
if (!html.includes("/assets/")) throw new Error("Build the production web entry first");
// Resolve provenance before creating output so a Git failure leaves no partial package.
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
let payload;
if (payloadReceipt) {
  const receipt = JSON.parse(await readFile(payloadReceipt, "utf8"));
  if (receipt.application !== "tetris-versus" || receipt.route !== "source-fud1" ||
      receipt.source_only_expected !== true) throw new Error("Expected the source Blocks app-build.json receipt");
  const bytes = await readFile(receipt.payload);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== receipt.payload_sha256) throw new Error("Payload does not match its source build receipt");
  const buildBytes = await readFile(receipt.build_receipt);
  if (createHash("sha256").update(buildBytes).digest("hex") !== receipt.build_receipt_sha256)
    throw new Error("Underlying source receipt hash mismatch");
  const build = JSON.parse(buildBytes);
  if (build.source_only !== true || build.payload_sha256 !== sha256)
    throw new Error("Underlying build does not establish a matching source-only payload");
  payload = { bytes, manifest: { file: `blocks.${sha256.slice(0, 12)}.pdlo.bin`, sha256,
    application: receipt.application, hardwareQualified: receipt.hardware_qualified === true,
    sourceBuildReceiptSha256: receipt.build_receipt_sha256 } };
}
await mkdir(destination); // Exclusive destination: do not overwrite another release.
for (const name of ["games", "assets"]) await cp(path.join(dist, name), path.join(destination, name), { recursive: true });
if (payload) {
  await writeFile(path.join(destination, "games", payload.manifest.file), payload.bytes);
  await writeFile(path.join(destination, "games/payload.json"), JSON.stringify(payload.manifest, null, 2) + "\n");
}
const files = {};
async function scan(dir) {
  for (const entry of await readdir(path.join(destination, dir), { withFileTypes: true })) {
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await scan(name);
    else files[name] = createHash("sha256").update(await readFile(path.join(destination, name))).digest("hex");
  }
}
await scan("games"); await scan("assets");
await writeFile(path.join(destination, "manifest.json"), JSON.stringify({ sourceCommit, dirty, files }, null, 2) + "\n");
console.log(`Staged ${Object.keys(files).length} files at ${destination}; source ${sourceCommit}${dirty ? " (uncommitted changes)" : ""}. Not deployed.`);
