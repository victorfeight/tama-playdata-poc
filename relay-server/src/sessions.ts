import crypto from "node:crypto";
import { Db } from "./db";

export type Role = "a" | "b";

export interface SessionRow {
  id: number;
  code: string;
  created_at: number;
  ended_at: number | null;
  outcome: string | null;
  bytes_ab: number;
  bytes_ba: number;
  ip_a: string | null;
  ip_b: string | null;
  ua_a: string | null;
  ua_b: string | null;
  token: string | null;
  app: string | null;
}

export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly ttlMs: number
  ) {}

  create(app: string | null = null, now = Date.now()): SessionRow {
    this.expire(now);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = crypto.randomBytes(4).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
      if (code.length !== 6) continue;
      try {
        const token = generateToken();
        this.db
          .prepare("INSERT INTO sessions (code, created_at, token, app) VALUES (?, ?, ?, ?)")
          .run(code, now, token, app);
        return this.get(code) as SessionRow;
      } catch {
        // Retry rare code collision.
      }
    }
    throw new Error("unable to allocate session code");
  }

  /** True if the supplied token matches the session's token. The 6-char code
   *  is the gate to fetch this token; once held it's good for either role
   *  slot in the session for the duration of the TTL. */
  validateToken(code: string, token: string | undefined): boolean {
    if (!token) return false;
    const row = this.get(code);
    return !!row && row.token !== null && row.token === token;
  }

  get(code: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE code = ?").get(code) as SessionRow | undefined;
  }

  markJoined(code: string, role: Role, ip: string, ua: string): void {
    const ipColumn = role === "a" ? "ip_a" : "ip_b";
    const uaColumn = role === "a" ? "ua_a" : "ua_b";
    this.db.prepare(`UPDATE sessions SET ${ipColumn} = ?, ${uaColumn} = ? WHERE code = ?`).run(ip, ua, code);
  }

  addBytes(code: string, direction: "ab" | "ba", bytes: number): void {
    const column = direction === "ab" ? "bytes_ab" : "bytes_ba";
    this.db.prepare(`UPDATE sessions SET ${column} = ${column} + ? WHERE code = ?`).run(bytes, code);
  }

  end(code: string, outcome: string, now = Date.now()): void {
    if (!this.db.open) return;
    this.db.prepare("UPDATE sessions SET ended_at = COALESCE(ended_at, ?), outcome = COALESCE(outcome, ?) WHERE code = ?").run(now, outcome, code);
  }

  expire(now = Date.now()): void {
    this.db
      .prepare("UPDATE sessions SET ended_at = ?, outcome = 'expired' WHERE ended_at IS NULL AND created_at < ?")
      .run(now, now - this.ttlMs);
  }

  isActive(row: SessionRow, now = Date.now()): boolean {
    return row.ended_at === null && row.created_at >= now - this.ttlMs;
  }
}

/** 32-byte random hex (64 chars), cryptographically unique per row. */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
