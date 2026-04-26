export interface RelayClientOptions {
  baseUrl: string;
  /** Tenant tag the server records on the session row for log/metrics
   *  partitioning ("playdate-web", "tamahome-desktop", etc.). */
  appName: string;
}

export interface RoomCreated {
  code: string;
  token: string;
}

export class RelayClient {
  constructor(private readonly options: RelayClientOptions) {}

  /** Create a fresh room. Returns the 6-char code (to share) and the
   *  WS-upgrade token (to keep). */
  async createRoom(): Promise<RoomCreated> {
    const response = await fetch(`${this.options.baseUrl}/sessions`, {
      method: "POST",
      headers: { "x-app-name": this.options.appName }
    });
    if (!response.ok) throw new Error(`create room failed: ${response.status}`);
    const data = (await response.json()) as { code: string; token: string };
    return { code: data.code, token: data.token };
  }

  /** Pick up the token for an existing room. Idempotent — repeated calls
   *  return the same token until the session expires. */
  async fetchToken(code: string): Promise<string> {
    const response = await fetch(`${this.options.baseUrl}/sessions/${code}/join`, {
      method: "POST",
      headers: { "x-app-name": this.options.appName }
    });
    if (!response.ok) throw new Error(`join room failed: ${response.status}`);
    const data = (await response.json()) as { token: string };
    return data.token;
  }

  connect(code: string, role: "a" | "b", token: string): WebSocket {
    const url = new URL(`/ws/${code}`, this.options.baseUrl.replace(/^http/, "ws"));
    url.searchParams.set("role", role);
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    return socket;
  }
}
