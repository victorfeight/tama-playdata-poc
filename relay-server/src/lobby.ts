import crypto from "node:crypto";
import { WebSocket, type RawData } from "ws";
import type { LobbyEntry, LobbyListing, LobbyMember, LobbySnapshot } from "@tama-breed-poc/tama-protocol";

interface Member extends LobbyMember {
  token: string;
  ws: WebSocket | undefined;
  expiresAt: number;
  legacy: boolean;
  starterChoice: boolean;
  peerConnection: string | undefined;
}
interface Room {
  code: string;
  visibility: "public" | "private";
  members: Member[];
  starterId?: string | undefined;
  startPrompt?: "prepare" | "ready" | "started" | undefined;
  readyUntil?: number | undefined;
  readyTimer?: ReturnType<typeof setTimeout> | undefined;
}

export class LobbyError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

/** Ephemeral membership around the existing unmodified stock byte exchange.
 * No firmware timing, packet conversion, start gate, or buffered replay here.
 */
export class LobbyHub {
  private readonly rooms = new Map<string, Room>();
  private readonly reservationMs = 60_000;
  private readonly maxRooms = 128;
  private readonly cleanup: ReturnType<typeof setInterval>;

  constructor(private readonly now: () => number = Date.now,
    private readonly codeInUse: (code: string) => boolean = () => false) {
    this.cleanup = setInterval(() => this.sweep(), 10_000);
    this.cleanup.unref();
  }

  create(nickname: string, visibility: "public" | "private"): LobbyEntry {
    this.sweep();
    const name = cleanNickname(nickname);
    if (this.rooms.size >= this.maxRooms) throw new LobbyError(503, "Rooms are busy. Please try again shortly.");
    let code: string;
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (this.rooms.has(code) || this.codeInUse(code));
    const room: Room = { code, visibility, members: [] };
    this.rooms.set(code, room);
    return this.add(room, name);
  }

  join(code: string, nickname: string): LobbyEntry {
    this.sweep();
    const room = this.rooms.get(code);
    if (!room) throw new LobbyError(404, "That room has closed. Ask for a new code.");
    const name = cleanNickname(nickname);
    if (room.members.length === 2) throw new LobbyError(409, "That room is full. Choose another room or create your own.");
    return this.add(room, name);
  }

  has(code: string): boolean { this.sweep(); return this.rooms.has(code); }

  /** Old desktop clients fetch a guest token repeatedly when reconnecting.
   * Never expose a browser host's credential or replace a browser-owned seat.
   */
  joinLegacy(code: string): { token: string; app: string } {
    this.sweep();
    const room = this.rooms.get(code);
    if (!room) throw new LobbyError(404, "That room has closed.");
    const guest = room.members.find(m => m.slot === 1);
    if (guest && !guest.legacy) throw new LobbyError(409, "That room is full.");
    const token = guest?.token ?? this.add(room, "Desktop friend", true).token;
    return { token, app: "playdate-web" };
  }

  attachLegacy(code: string, role: string, token: string | undefined, ws: WebSocket): void {
    const guest = this.rooms.get(code)?.members.find(m => m.token === token && m.legacy && m.slot === 1);
    if (role !== "b" || !guest) { ws.close(4401, "Invalid guest credential"); return; }
    this.attach(code, token, ws);
  }

  list(): LobbyListing[] {
    this.sweep();
    return [...this.rooms.values()].filter(room => room.visibility === "public" && room.members.length < 2 && room.members.some(m => m.connected))
      .map(room => ({ code: room.code, nickname: room.members[0]!.nickname, count: room.members.length, capacity: 2 }));
  }

  leave(code: string, token: string): void {
    const room = this.rooms.get(code);
    const member = room?.members.find(m => m.token === token);
    if (!room || !member) return;
    this.resetStart(room);
    room.members = room.members.filter(m => m !== member);
    member.ws?.close(1000, "left room");
    if (!room.members.length) this.rooms.delete(code);
    else this.broadcast(room);
  }

  attach(code: string, token: string | undefined, ws: WebSocket): void {
    this.sweep();
    const room = this.rooms.get(code);
    const member = room?.members.find(m => m.token === token);
    if (!room || !member) { ws.close(4404, "Room expired or invitation invalid"); return; }
    this.resetStart(room);
    const previous = member.ws;
    member.ws = ws;
    member.connected = true;
    member.adapterConnected = member.legacy ? null : false;
    member.starterChoice = false;
    member.peerConnection = undefined;
    member.connection++;
    previous?.close(4001, "Connected in another tab");
    this.broadcast(room);
    let alive = true;
    let controls = 0;
    let controlWindow = this.now();
    ws.on("pong", () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 20_000);
    heartbeat.unref();
    ws.on("message", (raw: RawData, binary: boolean) => {
      if (member.ws !== ws || !room.members.includes(member)) return;
      const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
      if (binary) {
        if (bytes.length > 256 * 1024) { ws.close(1009, "Serial message too large"); return; }
        if (bytes.length && room.startPrompt === "ready" && member.id === room.starterId) {
          this.resetStart(room);
          room.startPrompt = "started";
          this.broadcast(room);
        }
        const peer = room.members.find(m => m !== member);
        if (peer?.ws?.readyState === WebSocket.OPEN) {
          if (peer.ws.bufferedAmount > 1024 * 1024) peer.ws.close(1013, "Connection too slow; reconnect and retry");
          else peer.ws.send(bytes, { binary: true });
        }
        return;
      }
      if (this.now() - controlWindow >= 1000) { controls = 0; controlWindow = this.now(); }
      if (bytes.length > 512 || ++controls > 20) { ws.close(1008, "Too many room updates"); return; }
      try {
        const message = JSON.parse(bytes.toString());
        if (message?.type === "adapter" && typeof message.connected === "boolean") {
          member.adapterConnected = message.connected;
          member.starterChoice = message.starterChoice === true;
          if (!message.connected || !member.starterChoice) this.resetStart(room);
          if (!member.starterChoice) room.starterId = room.members.find(m => m.slot === 1)?.id;
          this.broadcast(room);
        }
        if (message?.type === "starter" && this.canChooseStarter(room) &&
            room.members.some(m => m.id === message.memberId) && room.starterId !== message.memberId) {
          room.starterId = message.memberId;
          this.resetStart(room);
          this.broadcast(room);
        }
        if (message?.type === "start-prompt" && this.canChooseStarter(room) && room.members.every(m => m.adapterConnected)) {
          if (message.action === "prepare" && member.id === room.starterId) {
            this.resetStart(room);
            room.startPrompt = "prepare";
            this.broadcast(room);
          } else if (message.action === "ready" && member.id !== room.starterId && room.startPrompt === "prepare") {
            room.startPrompt = "ready";
            room.readyUntil = this.now() + 8000;
            room.readyTimer = setTimeout(() => {
              this.resetStart(room);
              room.startPrompt = "prepare";
              this.broadcast(room);
            }, 8000);
            room.readyTimer.unref();
            this.broadcast(room);
          }
        }
      } catch { /* Invalid control text never enters the byte pipe. */ }
    });
    const closed = () => {
      clearInterval(heartbeat);
      if (member.ws !== ws || !room.members.includes(member)) return;
      this.resetStart(room);
      member.ws = undefined;
      member.connected = member.adapterConnected = false;
      member.expiresAt = this.now() + this.reservationMs;
      this.broadcast(room);
    };
    ws.on("close", closed);
    ws.on("error", closed);
  }

  sweep(): void {
    for (const room of this.rooms.values()) {
      const before = room.members.length;
      room.members = room.members.filter(m => m.connected || m.expiresAt > this.now());
      if (room.members.length !== before) this.resetStart(room);
      if (!room.members.length) this.rooms.delete(room.code);
      else if (room.members.length !== before) this.broadcast(room);
    }
  }

  close(): void {
    clearInterval(this.cleanup);
    for (const room of this.rooms.values()) {
      this.resetStart(room);
      for (const member of room.members) member.ws?.terminate();
    }
    this.rooms.clear();
  }

  private add(room: Room, nickname: string, legacy = false): LobbyEntry {
    const member: Member = {
      id: crypto.randomBytes(8).toString("hex"), token: crypto.randomBytes(32).toString("hex"), nickname,
      slot: room.members.some(m => m.slot === 0) ? 1 : 0,
      connected: false, adapterConnected: legacy ? null : false, connection: 0, ws: undefined,
      expiresAt: this.now() + this.reservationMs, legacy, starterChoice: false, peerConnection: undefined
    };
    room.members.push(member);
    this.broadcast(room);
    return { code: room.code, memberId: member.id, token: member.token };
  }

  private broadcast(room: Room): void {
    // Keep the choice through reconnects. A new pair defaults to the guest;
    // older desktop clients cannot display a changed instruction assignment.
    if (room.members.length !== 2) room.starterId = undefined;
    else if (room.members.some(m => m.legacy) || !room.members.some(m => m.id === room.starterId))
      room.starterId = room.members.find(m => m.slot === 1)?.id;
    const snapshot: LobbySnapshot = {
      type: "lobby", code: room.code, activity: "playdate", visibility: room.visibility, capacity: 2,
      starterId: room.starterId, canChooseStarter: this.canChooseStarter(room),
      startPrompt: room.startPrompt,
      readyForMs: room.readyUntil === undefined ? undefined : Math.max(0, room.readyUntil - this.now()),
      members: room.members.map(({ id, nickname, slot, connected, adapterConnected, connection }) =>
        ({ id, nickname, slot, connected, adapterConnected, connection }))
    };
    const text = JSON.stringify(snapshot);
    for (const member of room.members) if (member.ws?.readyState === WebSocket.OPEN) {
      if (!member.legacy) member.ws.send(text);
      else {
        const peer = room.members.find(m => m !== member && m.connected);
        const signature = peer ? `${peer.id}:${peer.connection}` : "";
        if (signature !== member.peerConnection && (signature || member.peerConnection))
          member.ws.send(signature ? "peer connected" : "peer disconnected");
        member.peerConnection = signature;
      }
    }
  }

  private canChooseStarter(room: Room): boolean {
    return room.members.length === 2 && room.members.every(m => m.connected && !m.legacy && m.starterChoice);
  }

  private resetStart(room: Room): void {
    if (room.readyTimer) clearTimeout(room.readyTimer);
    room.readyTimer = undefined;
    room.readyUntil = undefined;
    room.startPrompt = undefined;
  }
}

function cleanNickname(value: string): string {
  const name = value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
  if (!name || [...name].length > 20) throw new LobbyError(400, "Choose a nickname of 1–20 characters.");
  return name;
}
