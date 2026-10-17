import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { GameRoomHub } from "./game-rooms";
/** Opt-in during native/browser qualification. Same service, separate API. */
export function registerGameRooms(app: FastifyInstance): void {
  const hub = new GameRoomHub();
  app.addHook("preClose", async () => hub.close());
  const nickname = { type: "string", minLength: 1, maxLength: 80 };
  const game = { type: "string", enum: ["blocks", "pocket-puzzle"] };
  const codeParams = { type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[A-Z0-9]{6}$" } } };
  const joinRate = { rateLimit: { max: 60, timeWindow: "1 minute" } };
  app.get("/game-rooms", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async () => ({ rooms: hub.list() }));
  app.post<{ Body: { nickname: string; visibility: "public" | "private"; game: string } }>("/game-rooms", {
    bodyLimit: 1024, schema: { body: { type: "object", required: ["nickname", "visibility", "game"], additionalProperties: false,
      properties: { nickname, game, visibility: { type: "string", enum: ["public", "private"] } } } }
  }, async (request, reply) => reply.code(201).send(hub.create(request.body.nickname, request.body.visibility, request.body.game)));
  app.post<{ Params: { code: string }; Body: { nickname: string; game: string } }>("/game-rooms/:code/join", {
    bodyLimit: 1024, config: joinRate, schema: { params: codeParams, body: { type: "object", required: ["nickname", "game"], additionalProperties: false,
      properties: { nickname, game } } }
  }, async request => hub.join(request.params.code, request.body.nickname, request.body.game));
  app.post<{ Params: { code: string }; Body: { token: string } }>("/game-rooms/:code/leave", {
    bodyLimit: 1024, config: joinRate, schema: { params: codeParams, body: { type: "object", required: ["token"], additionalProperties: false,
      properties: { token: { type: "string", pattern: "^[a-f0-9]{64}$" } } } }
  }, async request => { hub.leave(request.params.code, request.body.token); return { ok: true }; });
  app.get<{ Params: { code: string } }>("/game-ws/:code", { websocket: true, config: joinRate }, (connection, request) => {
    const header = request.headers["sec-websocket-protocol"];
    const token = (Array.isArray(header) ? header.join(",") : header)?.split(",")[0]?.trim();
    hub.attach(request.params.code, token, connection as unknown as WebSocket);
  });
}
