import crypto from "node:crypto";
import { WebSocket, type RawData } from "ws";
import { HostedMatch, BLOCKS_HOSTED, PUZZLE_HOSTED, Tet3Session, type HostedGameId, type GameRoomEntry, type GameRoomSnapshot, type GameRoomListing } from "@tama-breed-poc/tama-protocol";
import { LobbyError, cleanNickname } from "./lobby";
interface Member {
  id: string; nickname: string; token: string; ws?: WebSocket | undefined;
  adapter: boolean; ready: boolean; net?: Tet3Session | undefined;
  reason?: string | undefined; expires: number; pong: number; ping: number;
  window: number; controls: number; bytes: number; lobbyCount: number;
}
interface Room {
  code: string; game: HostedGameId; visibility: "public" | "private"; owner: string;
  members: Member[]; match?: HostedMatch | undefined; roster: string[];
  expires: number; broadcastAt: number; lastSnapshot: string;
}
/** Hosted games terminate one TET3 connection per toy. Never a broadcast relay.
 * Separate routes/lifetime from the existing Playdate and direct Versus rooms. */
export class GameRoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly now = () => performance.now()) {
    this.timer = setInterval(() => this.tick(), 20); this.timer.unref();
  }
  create(nickname: string, visibility: "public" | "private", game: string): GameRoomEntry {
    this.sweep(); this.game(game);
    const name = cleanNickname(nickname);
    if (this.rooms.size >= 32) throw new LobbyError(503, "Game rooms are busy. Please try again shortly.");
    let code: string; do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (this.rooms.has(code));
    const room: Room = { code, game: game as HostedGameId, visibility, owner: "", members: [], roster: [],
      expires: this.now() + 2 * 60 * 60 * 1000, broadcastAt: 0, lastSnapshot: "" };
    this.rooms.set(code, room); return this.add(room, name);
  }
  join(code: string, nickname: string, game: string): GameRoomEntry {
    this.sweep(); const room = this.room(code); this.game(game);
    if (room.game !== game) throw new LobbyError(409, "This room is playing a different game.");
    if (room.match) throw new LobbyError(409, "This match has started. Join after the owner opens the next match.");
    if (room.members.length >= 16) throw new LobbyError(409, "This room has all 16 players.");
    return this.add(room, cleanNickname(nickname));
  }
  list(): GameRoomListing[] {
    this.sweep(); return [...this.rooms.values()].filter(r => r.visibility === "public" && !r.match && r.members.length < 16 && r.members.some(m => m.ws))
      .map(r => ({ code: r.code, game: r.game, nickname: r.members.find(m => m.id === r.owner)!.nickname, count: r.members.length, capacity: 16 }));
  }
  leave(code: string, token: string): void {
    const room = this.rooms.get(code), member = room?.members.find(m => m.token === token);
    if (!room || !member) return;
    this.detach(room, member, "Left room");
    const ws = member.ws; member.ws = undefined;
    room.members = room.members.filter(m => m !== member); ws?.close(1000, "Left room");
    this.owner(room); this.broadcast(room);
  }
  attach(code: string, token: string | undefined, ws: WebSocket): void {
    this.sweep(); const room = this.rooms.get(code), member = room?.members.find(m => m.token === token);
    if (!room || !member) { ws.close(4401, "Room expired or seat credential invalid"); return; }
    if (member.ws || member.net) this.detach(room, member, "Connection replaced; this match cannot resume");
    const old = member.ws; member.ws = ws; old?.close(4001, "Connected in another tab");
    member.pong = member.ping = this.now(); member.expires = Infinity;
    ws.on("pong", () => { if (member.ws === ws) member.pong = this.now(); });
    ws.on("message", (raw: RawData, binary: boolean) => {
      if (member.ws !== ws || !room.members.includes(member)) return;
      const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
      const now = this.now();
      if (now - member.window >= 1000) { member.window = now; member.controls = member.bytes = 0; }
      if (binary) {
        member.bytes += bytes.length;
        if (bytes.length > 8192 || member.bytes > 32768) { ws.close(1008, "Too much toy traffic"); return; }
        member.net?.receive(bytes, now); return;
      }
      if (bytes.length > 512 || ++member.controls > 20) { ws.close(1008, "Too many room controls"); return; }
      try { this.control(room, member, JSON.parse(bytes.toString())); }
      catch (error) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Invalid room control" })); }
    });
    const closed = () => {
      if (member.ws !== ws) return;
      member.ws = undefined; member.expires = this.now() + 60000;
      this.detach(room, member, "Browser disconnected; current match forfeited"); this.owner(room); this.broadcast(room);
    };
    ws.on("close", closed); ws.on("error", closed); this.broadcast(room);
  }
  close(): void {
    clearInterval(this.timer);
    for (const room of this.rooms.values()) for (const member of room.members) member.ws?.close(1001, "Game service restarting");
    this.rooms.clear();
  }
  private control(room: Room, member: Member, control: unknown): void {
    if (!control || typeof control !== "object" || !("type" in control)) throw new LobbyError(400, "Invalid room control");
    const m = control as Record<string, unknown>;
    if (m.type === "adapter" && typeof m.connected === "boolean") {
      if (!m.connected) this.detach(room, member, "Adapter disconnected");
      else if (!member.adapter) {
        if (room.match) throw new LobbyError(409, "Wait for a new match, then return to Online on your toy.");
        member.adapter = true; member.reason = undefined; member.lobbyCount = 0;
        const ws = member.ws!, nonce = crypto.randomBytes(4).readUInt32LE() || 1;
        member.net = new Tet3Session(this.policy(room).mode, nonce, this.now(), bytes => {
          if (member.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 65536) { ws.close(1013, "Connection too slow"); return; }
          ws.send(bytes, { binary: true });
        }, message => {
          const index = room.roster.indexOf(member.id);
          if (index >= 0) room.match?.receive(index, message, this.now());
        }, reason => {
          member.ready = false; member.reason = reason;
          const index = room.roster.indexOf(member.id);
          if (index >= 0) room.match?.disconnect(index, reason, this.now());
        });
      }
    } else if (m.type === "ready" && typeof m.ready === "boolean") {
      if (room.match) throw new LobbyError(409, "The match has already started.");
      if (m.ready && (!member.net?.ready || member.net.error)) throw new LobbyError(409, "Choose Online on your toy and wait for its connection.");
      member.ready = m.ready;
    } else if (m.type === "start") {
      if (room.owner !== member.id) throw new LobbyError(403, "Only the room owner can start.");
      if (room.match) throw new LobbyError(409, "The match has already started.");
      if (!this.canStart(room))
        throw new LobbyError(409, "Wait for at least two players and every toy to be ready.");
      const match = new HostedMatch(this.policy(room), room.members.map(m => ({ id: m.id, endpoint: m.net! })), () => crypto.randomBytes(4).readUInt32LE());
      match.start(this.now()); room.roster = room.members.map(m => m.id); room.match = match;
    } else if (m.type === "reset") {
      if (room.owner !== member.id) throw new LobbyError(403, "Only the room owner can open the next match.");
      if (!room.match || !["results", "aborted"].includes(room.match.phase)) throw new LobbyError(409, "Finish the current match first.");
      if (room.match.phase !== "aborted" && room.members.some(m => m.net && !m.net.error && m.net.pending)) throw new LobbyError(409, "Waiting for the final toy acknowledgements.");
      room.match = undefined; room.roster = [];
      for (const m of room.members) this.detach(room, m, "Return to the game menu, choose Online, then reconnect your toy here.");
    } else throw new LobbyError(400, "Unknown room control");
    this.broadcast(room);
  }
  private detach(room: Room, member: Member, reason: string): void {
    member.adapter = member.ready = false; member.reason = reason;
    const net = member.net; member.net = undefined;
    const index = room.roster.indexOf(member.id);
    if (index >= 0) room.match?.disconnect(index, reason, this.now());
    net?.stop(reason);
  }
  private canStart(room: Room): boolean {
    return !room.match && room.members.length >= 2 && room.members.every(m => m.ws?.readyState === WebSocket.OPEN && m.ready && m.net?.ready && !m.net.error);
  }
  private policy(room: Room) { return room.game === "blocks" ? BLOCKS_HOSTED : PUZZLE_HOSTED; }
  private game(game: string): void { if (game !== "blocks" && game !== "pocket-puzzle") throw new LobbyError(400, "This hosted game is not available yet."); }
  private room(code: string): Room { const r = this.rooms.get(code); if (!r) throw new LobbyError(404, "That game room has closed."); return r; }
  private add(room: Room, nickname: string): GameRoomEntry {
    const member: Member = { id: crypto.randomBytes(8).toString("hex"), token: crypto.randomBytes(32).toString("hex"), nickname,
      adapter: false, ready: false, expires: this.now() + 60000, pong: 0, ping: 0, window: 0, controls: 0, bytes: 0, lobbyCount: 0 };
    room.members.push(member); if (!room.owner) room.owner = member.id; this.broadcast(room);
    return { code: room.code, memberId: member.id, token: member.token, game: room.game };
  }
  private owner(room: Room): void {
    if (!room.members.length) { this.rooms.delete(room.code); return; }
    if (!room.members.some(m => m.id === room.owner && m.ws)) room.owner = (room.members.find(m => m.ws) ?? room.members[0])!.id;
  }
  private sweep(): void {
    for (const room of this.rooms.values()) {
      if (this.now() >= room.expires) {
        this.rooms.delete(room.code); for (const m of room.members) m.ws?.close(1001, "Room expired"); continue;
      }
      for (const m of [...room.members]) if (!m.ws && this.now() >= m.expires) this.leave(room.code, m.token);
    }
  }
  private tick(): void {
    this.sweep(); const now = this.now();
    for (const room of this.rooms.values()) {
      room.match?.tick(now);
      for (const member of room.members) {
        const seat = room.match?.snapshot().players.find(p => p.id === member.id);
        if (seat && !seat.connected && member.net && !member.net.error)
          member.net.stop(seat.reason ?? "This toy left the match");
        if (member.ws && now - member.pong > 40000) { member.ws.terminate(); continue; }
        if (member.ws?.readyState === WebSocket.OPEN && now - member.ping >= 20000) { member.ping = now; member.ws.ping(); }
        const net = member.net;
        if (!room.match && net?.ready && !net.error && member.lobbyCount !== room.members.length && net.pending < 4) {
          net.enqueue(13, 0, room.members.length); member.lobbyCount = room.members.length;
        }
        net?.poll(now);
      }
      if (now - room.broadcastAt >= 250) this.broadcast(room);
    }
  }
  private broadcast(room: Room): void {
    room.broadcastAt = this.now();
    const snapshot: GameRoomSnapshot = { type: "game-room", code: room.code, game: room.game, owner: room.owner,
      visibility: room.visibility, capacity: 16, canStart: this.canStart(room), members: room.members.map(m => ({ id: m.id, nickname: m.nickname,
        connected: m.ws?.readyState === WebSocket.OPEN, adapter: m.adapter, toyReady: !!m.net?.ready && !m.net.error,
        ready: m.ready, reason: m.reason })), match: room.match?.snapshot(),
      countdownMs: room.match?.phase === "countdown" ? Math.max(0, room.match.snapshot().deadline - this.now()) : undefined };
    const text = JSON.stringify(snapshot); if (text === room.lastSnapshot) return; room.lastSnapshot = text;
    for (const member of room.members) if (member.ws?.readyState === WebSocket.OPEN) {
      if (member.ws.bufferedAmount > 65536) member.ws.close(1013, "Connection too slow"); else member.ws.send(text);
    }
  }
}
