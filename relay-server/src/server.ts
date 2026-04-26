import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { Config } from "./config";
import { openDb } from "./db";
import { RelayHub } from "./relay";
import { Role, SessionStore } from "./sessions";

export async function buildServer(config: Config) {
  const app = Fastify({ logger: true });
  const db = openDb(config.dbPath);
  const sessions = new SessionStore(db, config.sessionTtlMs);
  const relay = new RelayHub(sessions);

  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ["content-type", "x-app-name"],
    methods: ["GET", "POST", "OPTIONS"]
  });
  await app.register(rateLimit, {
    max: 10,
    timeWindow: "1 minute"
  });
  await app.register(websocket);

  app.addHook("onClose", async () => {
    db.close();
  });

  app.get("/health", async () => ({ ok: true }));

  // Create a fresh room. Host gets back {code, token}. Anonymous create is
  // intentional — rate-limit + Cloudflare-only UFW are the protection
  // against spam, not a bundled secret. Knowing the 6-char code is the
  // gate to fetch the token; the token is the WS-upgrade credential.
  app.post("/sessions", async (request, reply) => {
    const appName = pickHeader(request.headers["x-app-name"]);
    const row = sessions.create(appName);
    return reply.code(201).send({
      code: row.code,
      token: row.token,
      app: row.app,
      ttlMs: config.sessionTtlMs
    });
  });

  // Guest pickup: returns the session's token. Idempotent — knowing the
  // 6-char code is the gate, the token is just the server-issued credential
  // the WS upgrade will check. Same value across calls so peer-refresh-
  // rejoin works without churn.
  app.post<{ Params: { code: string } }>("/sessions/:code/join", async (request, reply) => {
    sessions.expire();
    const { code } = request.params;
    const row = sessions.get(code);
    if (!row || !sessions.isActive(row) || !row.token) {
      return reply.code(404).send({ error: "session not found" });
    }
    return reply.send({ token: row.token, app: row.app });
  });

  app.get<{ Params: { code: string }; Querystring: { role?: Role; token?: string } }>("/ws/:code", { websocket: true }, (connection, request) => {
    const { code } = request.params;
    const role = request.query.role;
    const token = pickHeader(request.headers["x-poc-token"]) ?? request.query.token;
    const ws = connection as unknown as WebSocket;

    if (role !== "a" && role !== "b") {
      ws.close(4400, "role must be a or b");
      return;
    }

    sessions.expire();
    const row = sessions.get(code);
    if (!row || !sessions.isActive(row)) {
      ws.close(4404, "session not found");
      return;
    }
    if (!sessions.validateToken(code, token)) {
      ws.close(4401, "unauthorized");
      return;
    }
    if (relay.activeCount(code) >= 2) {
      ws.close(4409, "session full");
      return;
    }

    sessions.markJoined(code, role, request.ip, String(request.headers["user-agent"] ?? ""));
    relay.attach(code, role, ws);
  });

  return app;
}

function pickHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
