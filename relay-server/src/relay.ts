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
    // Evict any stale occupant for this role. Browser refresh races the new
    // WS open against the old WS close — the new arrival is the user's
    // current intent, so last-writer-wins.
    const stale = pair[role];
    if (stale) {
      try { stale.ws.close(4001, "replaced by reconnect"); } catch { /* already dead */ }
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

    const onClose = () => {
      clearInterval(heartbeat);
      // If this ws was already evicted by a reconnecting peer, the slot now
      // holds a different ws — leave it alone. Only the live occupant tears
      // down the pair and notifies the other side.
      const current = this.pairs.get(code);
      if (!current || current[role]?.ws !== ws) return;
      const other = role === "a" ? current.b : current.a;
      if (other?.ws.readyState === WebSocket.OPEN) other.ws.close(4000, "peer closed");
      // Tear down the in-memory pair so a fresh rejoin gets a clean slot,
      // but DO NOT mark the session ended — it stays rejoin-eligible until
      // SessionStore.expire() retires it on TTL.
      this.pairs.delete(code);
    };
    ws.on("close", onClose);
    ws.on("error", onClose);
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
