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
    const row = store.create("test", 1000);
    expect(row.code).toHaveLength(6);
    expect(row.token).toMatch(/^[0-9a-f]{64}$/);
    expect(row.app).toBe("test");
    expect(store.isActive(row, 1050)).toBe(true);

    expect(store.validateToken(row.code, row.token!)).toBe(true);
    expect(store.validateToken(row.code, "wrong")).toBe(false);
    expect(store.validateToken(row.code, undefined)).toBe(false);
    expect(store.validateToken("NOSUCH", row.token!)).toBe(false);

    store.touch(row.code, 1090);
    expect(store.isActive(store.get(row.code)!, 1150)).toBe(true);
    store.expire(1150);
    expect(store.get(row.code)?.ended_at).toBeNull();
    store.expire(1200);
    expect(store.get(row.code)?.outcome).toBe("expired");
    db.close();
  });

  it("keeps a connected room valid past creation TTL, then expires after idle TTL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tama-session-idle-"));
    const db = openDb(path.join(dir, "sessions.db"));
    const store = new SessionStore(db, 600_000);
    const row = store.create("test", 1000);
    store.touch(row.code, 601_000);
    store.expire(602_000);
    expect(store.isActive(store.get(row.code)!, 602_000)).toBe(true);
    store.touch(row.code, 602_000); // Last player leaves.
    store.expire(1_201_999);
    expect(store.get(row.code)?.ended_at).toBeNull();
    store.expire(1_202_001);
    expect(store.get(row.code)?.outcome).toBe("expired");
    db.close();
  });
});
