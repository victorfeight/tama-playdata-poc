import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { WebSocket } from "ws";
import { Config } from "./config";
import { openDb } from "./db";
import { RelayHub } from "./relay";
import { Role, SessionStore } from "./sessions";
import { LobbyHub } from "./lobby";
import { registerGameRooms } from "./game-room-routes";

export async function buildServer(config: Config) {
  // Walk X-Forwarded-For only through explicitly trusted proxies. Without this,
  // nginx makes every visitor share the loopback address's rate-limit bucket.
  const app = Fastify({ logger: true, trustProxy: config.trustedProxyCidrs ?? ["loopback"] });
  const db = openDb(config.dbPath);
  const sessions = new SessionStore(db, config.sessionTtlMs);
  const relay = new RelayHub(sessions);
  const lobby = new LobbyHub(Date.now, code => !!sessions.get(code));

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
  await app.register(websocket, {
    options: {
      maxPayload: 1024 * 1024,
      // The token rides in Sec-WebSocket-Protocol (see /ws handler below).
      // The browser requires the server to echo back the chosen subprotocol
      // or it rejects the upgrade — so we accept whatever the client sent.
      // Validation of the token happens in the route handler.
      handleProtocols: (protocols: Set<string>) => {
        const first = protocols.values().next().value;
        return first ?? false;
      }
    }
  });

  app.addHook("preClose", async () => { lobby.close(); });
  app.addHook("onClose", async () => {
    db.close();
  });

  app.get("/health", async () => ({ ok: true }));
  if (config.hostedGames) registerGameRooms(app);

  // Separate membership credentials per seat. Existing desktop/code-only
  // endpoints below retain their original contract.
  const nickname = { type: "string", minLength: 1, maxLength: 80 };
  const codeParams = { type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[A-Z0-9]{6}$" } } };
  app.get("/sessions/lobby", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async () => ({ rooms: lobby.list() }));
  app.post<{ Body: { nickname: string; visibility: "public" | "private" } }>("/sessions/lobby", {
    bodyLimit: 1024,
    schema: { body: { type: "object", required: ["nickname", "visibility"], additionalProperties: false,
      properties: { nickname, visibility: { type: "string", enum: ["public", "private"] } } } }
  }, async (request, reply) => reply.code(201).send(lobby.create(request.body.nickname, request.body.visibility)));
  app.post<{ Params: { code: string }; Body: { nickname: string } }>("/sessions/lobby/:code/join", {
    bodyLimit: 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: { params: codeParams, body: { type: "object", required: ["nickname"], additionalProperties: false, properties: { nickname } } }
  }, async request => lobby.join(request.params.code, request.body.nickname));
  app.post<{ Params: { code: string }; Body: { token: string } }>("/sessions/lobby/:code/leave", {
    bodyLimit: 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: { params: codeParams, body: { type: "object", required: ["token"], additionalProperties: false,
      properties: { token: { type: "string", pattern: "^[a-f0-9]{64}$" } } } }
  }, async request => { lobby.leave(request.params.code, request.body.token); return { ok: true }; });
  app.get<{ Params: { code: string } }>("/ws/lobby/:code", {
    websocket: true, config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, (connection, request) => {
    lobby.attach(request.params.code, pickFirstSubprotocol(request.headers["sec-websocket-protocol"]), connection as unknown as WebSocket);
  });

  // Create a fresh room. Host gets back {code, token}. Anonymous create is
  // intentional — rate-limit + Cloudflare-only UFW are the protection
  // against spam, not a bundled secret. Knowing the 6-char code is the
  // gate to fetch the token; the token is the WS-upgrade credential.
  app.post("/sessions", async (request, reply) => {
    const appName = pickHeader(request.headers["x-app-name"]);
    const row = sessions.create(appName, Date.now(), code => lobby.has(code));
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
  app.post<{ Params: { code: string } }>("/sessions/:code/join", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, async (request, reply) => {
    sessions.expire();
    const { code } = request.params;
    if (lobby.has(code)) return reply.send(lobby.joinLegacy(code));
    const row = sessions.get(code);
    if (!row || !sessions.isActive(row) || !row.token) {
      return reply.code(404).send({ error: "session not found" });
    }
    return reply.send({ token: row.token, app: row.app });
  });

  app.get<{ Params: { code: string }; Querystring: { role?: Role } }>("/ws/:code", {
    websocket: true, config: { rateLimit: { max: 60, timeWindow: "1 minute" } }
  }, (connection, request) => {
    const { code } = request.params;
    const role = request.query.role;
    // Token rides in Sec-WebSocket-Protocol (subprotocol smuggling, per the
    // SO/WICG community pattern for browser WS auth). Keeps the token out of
    // request URLs and therefore out of nginx access logs and journald.
    const token = pickFirstSubprotocol(request.headers["sec-websocket-protocol"]);
    const ws = connection as unknown as WebSocket;

    if (role !== "a" && role !== "b") {
      ws.close(4400, "role must be a or b");
      return;
    }

    if (lobby.has(code)) {
      lobby.attachLegacy(code, role, token, ws);
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
    if (relay.activeCount(code) >= 2 && !relay.hasRole(code, role)) {
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

/** Sec-WebSocket-Protocol is a comma-separated list. The client sends
 *  exactly one entry (the token) but headers split across multiple lines
 *  can also arrive as an array. Take the first non-empty value. */
function pickFirstSubprotocol(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()).find((s) => s.length > 0);
}
