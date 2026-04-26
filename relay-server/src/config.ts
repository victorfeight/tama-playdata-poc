import path from "node:path";

export interface Config {
  port: number;
  dbPath: string;
  sessionTtlMs: number;
}

export function readConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    dbPath: path.resolve(process.cwd(), env.DB_PATH ?? "./data/sessions.db"),
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 10 * 60 * 1000)
  };
}
