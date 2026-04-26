import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      ended_at INTEGER,
      outcome TEXT,
      bytes_ab INTEGER NOT NULL DEFAULT 0,
      bytes_ba INTEGER NOT NULL DEFAULT 0,
      ip_a TEXT,
      ip_b TEXT,
      ua_a TEXT,
      ua_b TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_code_idx ON sessions(code);
    CREATE INDEX IF NOT EXISTS sessions_created_idx ON sessions(created_at);
  `);
  // Per-session token — the WS-upgrade credential. One token per session
  // (the 6-char code remains the join gate; the token is the proof that
  // you know the code). Added idempotently — sqlite has no
  // ADD COLUMN IF NOT EXISTS.
  addColumnIfMissing(db, "sessions", "token", "TEXT");
  // Tenant tag — claimed by the creator (e.g. "playdate-web", "tamahome-desktop").
  // Lets us partition logs / rate limits / metrics per app without separate
  // relay deployments.
  addColumnIfMissing(db, "sessions", "app", "TEXT");
}

function addColumnIfMissing(db: Db, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
