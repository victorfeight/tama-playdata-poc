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
    allowedHeaders: ["content-type", "x-poc-secret"],
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

  app.post("/sessions", async (request, reply) => {
    if (!isAuthorized(request.headers["x-poc-secret"], config.sharedSecret)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const row = sessions.create();
    return reply.code(201).send({ code: row.code, ttlMs: config.sessionTtlMs });
  });

  app.get<{ Params: { code: string }; Querystring: { role?: Role; secret?: string } }>("/ws/:code", { websocket: true }, (connection, request) => {
    const { code } = request.params;
    const role = request.query.role;
    const secret = request.headers["x-poc-secret"] ?? request.query.secret;
    const ws = connection as unknown as WebSocket;

    if (!isAuthorized(secret, config.sharedSecret)) {
      ws.close(4401, "unauthorized");
      return;
    }
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
    if (relay.activeCount(code) >= 2) {
      ws.close(4409, "session full");
      return;
    }

    sessions.markJoined(code, role, request.ip, String(request.headers["user-agent"] ?? ""));
    relay.attach(code, role, ws);
  });

  return app;
}

function isAuthorized(value: string | string[] | undefined, expected: string): boolean {
  return (Array.isArray(value) ? value[0] : value) === expected;
}
