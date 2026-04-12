import path from "node:path";

export interface Config {
  port: number;
  sharedSecret: string;
  dbPath: string;
  sessionTtlMs: number;
}

export function readConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    sharedSecret: env.SHARED_SECRET ?? "dev-only",
    dbPath: path.resolve(process.cwd(), env.DB_PATH ?? "./data/sessions.db"),
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 10 * 60 * 1000)
  };
}
