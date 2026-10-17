// Packaging contract test against a real source-build receipt; no upload.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const receiptPath = process.argv[2];
if (!receiptPath) throw new Error("Usage: node scripts/test-package-game-demo.mjs /path/to/source-app-build.json");
const directory = await mkdtemp(path.join(tmpdir(), "blocks-package-test-"));
const packager = fileURLToPath(new URL("package-game-demo.mjs", import.meta.url));
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const run = (output, receipt) => spawnSync(process.execPath, [packager, output, receipt], { encoding: "utf8" });
try {
  const good = path.join(directory, "good");
  let result = run(good, receiptPath); assert.equal(result.status, 0, result.stderr);
  const manifestName = receipt.application === "pocket-puzzle" ? "payload-pocket-puzzle.json" : "payload.json";
  const manifest = JSON.parse(await readFile(path.join(good, "games", manifestName), "utf8"));
  assert.equal(manifest.sha256, receipt.payload_sha256);
  result = run(good, receiptPath); assert.notEqual(result.status, 0, "Existing package must not be overwritten");
  for (const [name, changed] of [
    ["stale-bin", { ...receipt, payload_sha256: "0".repeat(64) }],
    ["stale-receipt", { ...receipt, build_receipt_sha256: "0".repeat(64) }],
    ["wrong-route", { ...receipt, route: "bundled-fup7" }],
    ["wrong-game", { ...receipt, application: receipt.application === "pocket-puzzle" ? "tetris-versus" : "pocket-puzzle" }]
  ]) {
    const input = path.join(directory, `${name}.json`), output = path.join(directory, name);
    await writeFile(input, JSON.stringify(changed));
    result = run(output, input); assert.notEqual(result.status, 0, name);
    await assert.rejects(access(output), `${name} must fail before creating a partial package`);
  }
  const [otherReceipt, setupArchive] = process.argv.slice(3);
  if (otherReceipt && setupArchive) {
    const full = path.join(directory, "full");
    result = spawnSync(process.execPath, [packager, full, receiptPath, otherReceipt, "--full-web", `--music-setup=${setupArchive}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(full, "manifest.json"), "utf8"));
    assert(manifest.fullWeb && manifest.files["index.html"] && manifest.files["games/index.html"]);
    const puzzle = JSON.parse(await readFile(path.join(full, "games/payload-pocket-puzzle.json"), "utf8"));
    assert(manifest.files[`games/${puzzle.setup.file}`] === puzzle.setup.sha256);
    const badSetup = path.join(directory, "bad.zip");
    await writeFile(badSetup, await readFile(setupArchive));
    const setupReceipt = JSON.parse(await readFile(setupArchive.slice(0, -4) + ".json", "utf8"));
    await writeFile(badSetup.slice(0, -4) + ".json", JSON.stringify({ ...setupReceipt, game_sha256: "0".repeat(64) }));
    const badOutput = path.join(directory, "bad-setup");
    result = spawnSync(process.execPath, [packager, badOutput, receiptPath, otherReceipt, "--full-web", `--music-setup=${badSetup}`], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "Setup must contain the exact published game");
    await assert.rejects(access(badOutput));
  }
  console.log("PASS verified source payload, exclusive output, stale BIN, stale receipt and wrong-route rejection");
} finally { await rm(directory, { recursive: true, force: true }); }
