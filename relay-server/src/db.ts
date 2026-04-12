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
}
