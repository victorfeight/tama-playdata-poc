/** Production browser service over the SDK's actual native UART adapter. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { GameInstallService, type InstallProgress } from '../web-client/src/game-install-service';

const [configuration, site, output] = process.argv.slice(2);
if (!configuration || !site || !output) throw new Error('Usage: test-native-installer.ts config.json packaged-site output');
const config = JSON.parse(await readFile(configuration, 'utf8'));
const manifest = JSON.parse(await readFile(path.join(site, 'games/payload-pocket-puzzle.json'), 'utf8'));
await mkdir(output, { recursive: true });
const args = ['scripts/native-install-peer.py'];
for (const name of ['sdk', 'firmware', 'library', 'nm']) args.push('--' + name, config[name]);
args.push('--game-elf', config.gameElf, '--output', output,
  '--bundle', path.join(site, 'games', manifest.music.bundle.file), '--game', path.join(site, 'games', manifest.file));
const peer = spawn(config.python, args, { stdio: ['pipe', 'pipe', 'inherit'] });
let nextId = 0, closed = false;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
createInterface({ input: peer.stdout }).on('line', line => {
  const value = JSON.parse(line), waiter = pending.get(value.id);
  pending.delete(value.id);
  if (value.error) waiter?.reject(new Error(JSON.stringify(value)));
  else waiter?.resolve(value);
});
function fail(error: Error) { closed = true; for (const waiter of pending.values()) waiter.reject(error); pending.clear(); }
peer.on('error', fail);
peer.on('exit', code => fail(new Error(`Native peer exited (${code})`)));
const request = (op: string, fields = {}) => new Promise<any>((resolve, reject) => {
  if (closed) { reject(new Error('Native peer is closed')); return; }
  const id = ++nextId; pending.set(id, { resolve, reject });
  peer.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n');
});
let readers = 0, maxReaders = 0, phase = '';
const progress = (value: InstallProgress) => {
  if (value.phase !== phase || (value.total === 248 && (value.done ?? 0) % 32 === 0)) {
    phase = value.phase; console.log(phase, value.done ?? '', '/', value.total ?? '');
  }
};
const transport = {
  name: 'SDK native UART',
  async read() {
    maxReaders = Math.max(maxReaders, ++readers);
    try { return new Uint8Array(Buffer.from((await request('read')).data, 'base64')); }
    finally { readers--; }
  },
  async write(bytes: Uint8Array) { await request('write', { data: Buffer.from(bytes).toString('base64') }); },
  async close() { peer.stdin.end(); }
};
const fetchLocal = (async (url: URL) => new Response(await readFile(url))) as typeof fetch;
const service = new GameInstallService(pathToFileURL(path.resolve(site, 'games') + '/'), fetchLocal);
try {
  console.log('Native menu replay', await request('open'));
  const music = await service.installMusic(transport, manifest.music, progress);
  await request('music-complete'); console.log('Native C return and Download re-entry passed');
  await service.sendGame(transport, manifest, progress);
  const game = await request('game-complete');
  assert.equal(maxReaders, 1);
  await writeFile(path.join(output, 'service.json'), JSON.stringify({ passed: true, music,
    maxReaders, game, scope: 'Actual browser service, source helper, firmware UART and game music; simulated physical menu inputs' }, null, 2));
  console.log('PASS native browser installer', music);
} finally { await transport.close(); }
