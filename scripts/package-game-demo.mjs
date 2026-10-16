// Local-only staging. Existing destinations are refused; no upload/deploy.
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/package-game-demo.mjs /new/staging-directory");
const destination = path.resolve(output), dist = path.join(root, "web-client/dist");
const html = await readFile(path.join(dist, "games/index.html"), "utf8");
if (!html.includes("/assets/")) throw new Error("Build the production web entry first");
// Resolve provenance before creating output so a Git failure leaves no partial package.
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim());
await mkdir(destination); // Exclusive destination: do not overwrite another release.
for (const name of ["games", "assets"]) await cp(path.join(dist, name), path.join(destination, name), { recursive: true });
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
