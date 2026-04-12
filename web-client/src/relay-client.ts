export interface RelayClientOptions {
  baseUrl: string;
  secret: string;
}

export class RelayClient {
  constructor(private readonly options: RelayClientOptions) {}

  async createRoom(): Promise<string> {
    const response = await fetch(`${this.options.baseUrl}/sessions`, {
      method: "POST",
      headers: { "x-poc-secret": this.options.secret }
    });
    if (!response.ok) throw new Error(`create room failed: ${response.status}`);
    const data = (await response.json()) as { code: string };
    return data.code;
  }

  connect(code: string, role: "a" | "b"): WebSocket {
    const url = new URL(`/ws/${code}`, this.options.baseUrl.replace(/^http/, "ws"));
    url.searchParams.set("role", role);
    url.searchParams.set("secret", this.options.secret);
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    return socket;
  }
}
