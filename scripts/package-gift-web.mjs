// Package the shared Gift entry for the existing trade domain. Uses the same
// manifest publisher as Playdate/Games, without bundling game/music downloads.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/package-gift-web.mjs NEW_DIRECTORY');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceCommit = git(['rev-parse', 'HEAD']);
if (git(['status', '--porcelain'])) throw new Error('Commit the reviewed source before packaging');
const dist = path.join(root, 'web-client/dist'), destination = path.resolve(output);
// Build the pinned clean source here, so an old dist directory cannot masquerade
// as this commit. Both URLs are explicit; local test settings cannot leak in.
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tama-protocol/tsconfig.json'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'web-client/tsconfig.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'web-client/node_modules/vite/bin/vite.js'), 'build'], {
  cwd: path.join(root, 'web-client'), stdio: 'inherit',
  env: { ...process.env, VITE_GIFT_RELAY_URL: 'https://trade.bbamorachi.us', VITE_RELAY_URL: 'https://playdate.bbamorachi.us' }
});
const html = await readFile(path.join(dist, 'gifts/index.html'), 'utf8');
if (!html.includes('/assets/') || !html.includes('Gifts · Paradise Link')) throw new Error('Build the Gift entry first');
const filesIn = async directory => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink in build output');
    if (entry.isDirectory()) files.push(...await filesIn(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
};
for (const file of await filesIn(path.join(dist, 'assets'))) {
  if (file.endsWith('.js') && /https?:\/\/(?:localhost|127\.0\.0\.1):/.test(await readFile(file, 'utf8')))
    throw new Error('Local-test relay URL in build; rebuild with production configuration');
}
await mkdir(destination, { recursive: false });
await writeFile(path.join(destination, 'index.html'), html);
for (const folder of ['assets', 'sprites']) await cp(path.join(dist, folder), path.join(destination, folder), { recursive: true });
const files = {};
for (const file of (await filesIn(destination)).sort())
  files[path.relative(destination, file).split(path.sep).join('/')] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({
  sourceCommit, dirty: false, fullWeb: false, activity: 'gift',
  sourceRepository: 'victorfeight/tama-playdata-poc',
  publicOrigin: 'https://trade.bbamorachi.us', requiredRelayActivity: 'gift', files
}, null, 2) + '\n');
console.log(JSON.stringify({ destination, sourceCommit, files: Object.keys(files).length }));
