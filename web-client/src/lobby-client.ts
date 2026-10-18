import type { LobbyEntry, LobbyListing, LobbySnapshot, StockActivity } from "@tama-breed-poc/tama-protocol";

class LobbyHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Shared room API. Activity pages own their presentation and serial bridge. */
export class LobbyClient {
  constructor(private readonly baseUrl: string, readonly activity: StockActivity = "playdate") {}

  async list(): Promise<LobbyListing[]> {
    return (await this.request<{ rooms: LobbyListing[] }>("/sessions/lobby")).rooms;
  }
  create(nickname: string, visibility: "public" | "private"): Promise<LobbyEntry> {
    return this.request("/sessions/lobby", { nickname, visibility });
  }
  async join(code: string, nickname: string): Promise<LobbyEntry> {
    try { return await this.request(`/sessions/lobby/${encodeURIComponent(code)}/join`, { nickname }); }
    catch (error) { if (!(error instanceof LobbyHttpError) || error.status !== 404) throw error; }
    const old = await this.request<{ token: string; app: string | null }>(`/sessions/${encodeURIComponent(code)}/join`, {});
    const allowed = this.activity === "gift" ? ["trade-web", "gift-web", "tamahome-desktop-gift"] : ["playdate-web", "tamahome-desktop-playdate"];
    if (old.app !== null && !allowed.includes(old.app))
      throw new Error(`That code belongs to another activity. Ask for a ${this.activity === "gift" ? "Gift" : "Playdate"} room code.`);
    return { code, token: old.token, memberId: "legacy-guest", legacyNickname: nickname };
  }
  async leave(entry: LobbyEntry): Promise<void> {
    if (entry.legacyNickname) return; // Closing the old socket releases its guest role.
    await this.request(`/sessions/lobby/${entry.code}/leave`, { token: entry.token });
  }
  connect(entry: LobbyEntry): WebSocket {
    const url = new URL(entry.legacyNickname ? `/ws/${entry.code}?role=b` : `/ws/lobby/${entry.code}`, this.baseUrl.replace(/^http/, "ws"));
    const socket = new WebSocket(url, entry.token);
    socket.binaryType = "arraybuffer";
    if (entry.legacyNickname) {
      // Adapt old presence text to UI metadata only; binary UART is untouched.
      let present = false, connection = 0;
      const publish = () => {
        const snapshot: LobbySnapshot = { type: "lobby", code: entry.code, activity: this.activity, visibility: "private", capacity: 2,
          members: [
            { id: "legacy-host", nickname: "Your friend", slot: 0, connected: present, adapterConnected: null, connection },
            { id: entry.memberId, nickname: entry.legacyNickname!, slot: 1, connected: true, adapterConnected: null, connection: 1 }
          ] };
        socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(snapshot) }));
      };
      socket.addEventListener("open", publish);
      socket.addEventListener("message", event => {
        if (event.data === "peer connected") { present = true; connection++; publish(); }
        else if (event.data === "peer disconnected") { present = false; publish(); }
      });
    }
    return socket;
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new LobbyHttpError(response.status, response.status === 429 ? "Please wait a moment before trying again."
        : detail.message ?? detail.error ?? "The lobby is unavailable. Please try again.");
    }
    return response.json() as Promise<T>;
  }
}
