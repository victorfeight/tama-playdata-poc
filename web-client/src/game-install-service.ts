import { UartChannel, prepareDownload, sendDownload, streamMusic, removeMusicBank, validateMusicBundle, type Transport } from "@tama-breed-poc/tama-protocol";

export interface InstallAsset { file: string; sha256: string; bytes: number }
export interface MusicRemovalAssets { helper: InstallAsset; bankCrc32: number; sectors: 256 }
export interface MusicAssets { helper: InstallAsset; bundle: InstallAsset; profile: string; sectors: number; removal?: MusicRemovalAssets }
export interface InstallProgress { phase: string; done?: number; total?: number }

export function isInstallAsset(value: unknown): value is InstallAsset {
  if (!value || typeof value !== "object") return false;
  const a = value as InstallAsset;
  return typeof a.file === "string" && /^[a-z0-9][a-z0-9.-]*\.bin$/.test(a.file) &&
    typeof a.sha256 === "string" && /^[a-f0-9]{64}$/.test(a.sha256) && Number.isInteger(a.bytes) && a.bytes > 0 && a.bytes <= 1_100_000;
}
export function isMusicAssets(value: unknown): value is MusicAssets {
  if (!value || typeof value !== "object") return false;
  const m = value as MusicAssets;
  return isInstallAsset(m.helper) && m.helper.bytes <= 65536 && isInstallAsset(m.bundle) &&
    m.profile === "puzzle-music" && Number.isInteger(m.sectors) && m.sectors > 0 && m.sectors <= 256 &&
    (m.removal === undefined || isMusicRemovalAssets(m.removal));
}
export function isMusicRemovalAssets(value: unknown): value is MusicRemovalAssets {
  if (!value || typeof value !== "object") return false;
  const m = value as MusicRemovalAssets;
  return isInstallAsset(m.helper) && m.helper.bytes === 65532 && m.sectors === 256 &&
    Number.isInteger(m.bankCrc32) && m.bankCrc32 >= 0 && m.bankCrc32 <= 0xffffffff;
}

/** Browser orchestration only; shared protocol owns every UART transaction.
 * The owner keeps its open transport for the next Download or relay bridge.
 */
export class GameInstallService {
  private active = false;
  constructor(private readonly baseUrl: URL,
    private readonly fetchAsset: typeof fetch = (...args) => fetch(...args)) {}

  async sendGame(transport: Transport, asset: InstallAsset, progress: (p: InstallProgress) => void): Promise<void> {
    await this.exclusive(async () => {
      progress({ phase: "Checking game download…" });
      const bytes = await this.load(asset);
      const prepared = await prepareDownload(bytes);
      const channel = new UartChannel(transport);
      try {
        await sendDownload(channel, prepared, (done, total) => progress({ phase: "Sending game…", done, total }));
      } finally { channel.release(); }
    });
  }

  async installMusic(transport: Transport, assets: MusicAssets, progress: (p: InstallProgress) => void): Promise<{ written: number; matched: number }> {
    return this.exclusive(async () => {
      if (!isMusicAssets(assets)) throw new Error("Invalid music package. Refresh the page before retrying.");
      progress({ phase: "Checking music download…" });
      const [helper, bundle] = await Promise.all([this.load(assets.helper), this.load(assets.bundle)]);
      const records = validateMusicBundle(bundle, assets.profile, assets.sectors);
      const prepared = await prepareDownload(helper);
      const channel = new UartChannel(transport);
      try {
        await sendDownload(channel, prepared, (done, total) => progress({ phase: "Sending music installer…", done, total }));
        progress({ phase: "Checking firmware and music space…" });
        const result = await streamMusic(channel, bundle, records, value => progress({
          phase: value.completed === value.total ? "Verifying complete music bank…" : "Installing / verifying music…",
          done: value.completed, total: value.total
        }));
        return { written: result.written, matched: result.matched };
      } finally { channel.release(); }
    });
  }

  async removeMusic(transport: Transport, assets: MusicRemovalAssets, progress: (p: InstallProgress) => void): Promise<{ written: number; matched: number }> {
    return this.exclusive(async () => {
      if (!isMusicRemovalAssets(assets)) throw new Error("Invalid music removal package. Refresh before retrying.");
      progress({ phase: "Checking music remover download…" });
      const prepared = await prepareDownload(await this.load(assets.helper));
      const channel = new UartChannel(transport);
      try {
        await sendDownload(channel, prepared, (done, total) => progress({ phase: "Sending music remover…", done, total }));
        progress({ phase: "Checking firmware and music ownership…" });
        return await removeMusicBank(channel, assets.bankCrc32, value => progress({
          phase: value.completed === value.total ? "Verifying empty music space…" : "Removing music…",
          done: value.completed, total: value.total
        }));
      } finally { channel.release(); }
    });
  }

  private async load(asset: InstallAsset): Promise<Uint8Array> {
    if (!isInstallAsset(asset)) throw new Error("Invalid download manifest. Refresh the page before retrying.");
    const response = await this.fetchAsset(new URL(asset.file, this.baseUrl), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Could not download the installation files. Please try again.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== asset.bytes) throw new Error("Incomplete installation download. Nothing was sent to your toy.");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hash !== asset.sha256) throw new Error("Installation file verification failed. Nothing was sent to your toy.");
    return bytes;
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error("An installation is already running.");
    this.active = true;
    try { return await operation(); } finally { this.active = false; }
  }
}
