import { WebSocket } from "ws";
import { SessionStore, Role } from "./sessions";

interface Peer {
  role: Role;
  ws: WebSocket;
}

interface Pair {
  a?: Peer | undefined;
  b?: Peer | undefined;
}

// Pure byte pipe. Any gating / holding / role-asymmetry introduced more
// first-try failures than it prevented; Paradise firmware's own retry
// mechanism handles collisions fine if we stay out of the way.
export class RelayHub {
  private readonly pairs = new Map<string, Pair>();
  private readonly heartbeatMs = 25_000;

  constructor(private readonly sessions: SessionStore) {}

  attach(code: string, role: Role, ws: WebSocket): void {
    const pair = this.pairs.get(code) ?? {};
    if (pair[role]) {
      ws.close(4409, "role already connected");
      return;
    }

    pair[role] = { role, ws };
    this.pairs.set(code, pair);

    ws.binaryType = "arraybuffer";
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, this.heartbeatMs);

    ws.on("message", (data) => {
      const other = role === "a" ? pair.b : pair.a;
      if (!other || other.ws.readyState !== WebSocket.OPEN) return;
      const bytes = toBuffer(data);
      other.ws.send(bytes);
      this.sessions.addBytes(code, role === "a" ? "ab" : "ba", bytes.length);
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      const other = role === "a" ? pair.b : pair.a;
      if (other?.ws.readyState === WebSocket.OPEN) other.ws.close(4000, "peer closed");
      this.sessions.end(code, "closed");
      this.pairs.delete(code);
    });

    ws.on("error", () => {
      this.sessions.end(code, "error");
    });
  }

  activeCount(code: string): number {
    const pair = this.pairs.get(code);
    return Number(Boolean(pair?.a)) + Number(Boolean(pair?.b));
  }
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
