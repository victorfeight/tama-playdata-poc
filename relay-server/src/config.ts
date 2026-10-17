import path from "node:path";

export interface Config {
  port: number;
  dbPath: string;
  sessionTtlMs: number;
  trustedProxyCidrs?: string[];
  hostedGames?: boolean;
}

export function readConfig(env = process.env): Config {
  return {
    hostedGames: env.HOSTED_GAMES === "1",
    port: Number(env.PORT ?? 3001),
    dbPath: path.resolve(process.cwd(), env.DB_PATH ?? "./data/sessions.db"),
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 10 * 60 * 1000),
    trustedProxyCidrs: (env.RELAY_TRUSTED_PROXIES ?? "loopback").split(",").map(value => value.trim()).filter(Boolean)
  };
}
