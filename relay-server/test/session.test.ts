import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db";
import { SessionStore } from "../src/sessions";

describe("SessionStore", () => {
  it("creates and expires a session", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tama-session-"));
    const db = openDb(path.join(dir, "sessions.db"));
    const store = new SessionStore(db, 100);
    const row = store.create(1000);
    expect(row.code).toHaveLength(6);
    expect(store.isActive(row, 1050)).toBe(true);
    store.expire(1200);
    expect(store.get(row.code)?.outcome).toBe("expired");
    db.close();
  });
});
