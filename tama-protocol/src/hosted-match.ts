import type { Tet3Message } from "./tet3-session";

/** Pure external-host match policy. No network, timers, credentials or UI.
 * Wire evidence: SDK research/tetris-versus/EXTERNAL_HOST_DESIGN.md.
 * Targeting/settlement/forfeit rules are ours, not recovered website behavior. */
export interface HostedEndpoint {
  readonly ready: boolean;
  readonly error: string | undefined;
  readonly pending: number;
  enqueue(type: number, round: number, a: number, b: number, c: number): boolean;
}
export interface HostedGamePolicy {
  readonly id: string;
  readonly mode: number;
  readonly maxAttack: number;
  readonly garbageColumns: number;
}
export const BLOCKS_HOSTED: HostedGamePolicy = Object.freeze({
  id: "blocks", mode: 4, maxAttack: 7, garbageColumns: 10
});
export const PUZZLE_HOSTED: HostedGamePolicy = Object.freeze({
  id: "pocket-puzzle", mode: 0x50500202, maxAttack: 18, garbageColumns: 1
});
export type HostedPhase = "lobby" | "preparing" | "countdown" | "playing" | "round-result" | "results" | "aborted";
interface Seat {
  id: string; endpoint: HostedEndpoint; connected: boolean; prepared: boolean;
  target: number; garbageId: number; outbox: Tet3Message[]; reason?: string;
}
const SETTLE_MS = 300, PREPARE_MS = 10000, COUNTDOWN_MS = 3000, RESULT_MS = 3000;
const OUTBOX_LIMIT = 32;

export class HostedMatch {
  phase: HostedPhase = "lobby";
  round = 0;
  seed = 0;
  wins = 0;
  alive = 0;
  winner: number | undefined;
  reason: string | undefined;
  private seats: Seat[];
  private deadline = 0;
  private settleAt: number | undefined;
  private finishAfterResult = false;

  constructor(readonly policy: HostedGamePolicy, players: { id: string; endpoint: HostedEndpoint }[],
    private readonly random: () => number) {
    if (players.length < 2 || players.length > 16 || new Set(players.map(p => p.id)).size !== players.length)
      throw new Error("A match needs 2–16 distinct seats");
    this.seats = players.map(p => ({ ...p, connected: true, prepared: false, target: 0, garbageId: 0, outbox: [] }));
  }

  snapshot() {
    return { phase: this.phase, round: this.round, seed: this.seed, wins: this.wins,
      alive: this.alive, winner: this.winner, reason: this.reason, deadline: this.deadline,
      players: this.seats.map((s, index) => ({ id: s.id, index, connected: s.connected,
        alive: !!(this.alive & (1 << index)), wins: (this.wins >>> (2 * index)) & 3,
        target: this.nextTarget(index), queued: s.outbox.length + s.endpoint.pending,
        reason: s.reason })) };
  }

  start(now: number): void {
    if (this.phase !== "lobby") throw new Error("Match already started");
    if (this.seats.some(s => !s.connected || !s.endpoint.ready || s.endpoint.error))
      throw new Error("Wait for every toy handshake");
    // Lobby status or a heartbeat may still await ACK after the browser saw
    // ready. START uses the same ordered queue; preparation already waits for
    // the seed acknowledgement and drain. An idle queue is not an admission
    // condition (it would race every heartbeat and the owner's click).
    this.beginRound(now);
  }

  receive(index: number, message: Tet3Message, now: number): void {
    const seat = this.seats[index];
    if (!seat?.connected || this.phase === "aborted" || this.phase === "results") return;
    const { type, round, a, b, c } = message;
    if (type === 12 || type === 15) { this.disconnect(index, "Toy left the match", now); return; }
    if (round !== this.round) return;
    if (type === 3 && this.phase === "preparing" && a === this.seed && !b && !c) { seat.prepared = true; return; }
    if (this.phase !== "playing" || !(this.alive & (1 << index))) return;
    if (type === 8 && !a && !b && !c) { this.eliminate(index, now); return; }
    if (type !== 6 || !Number.isInteger(a) || a < 1 || a > this.policy.maxAttack || b || c) return;
    const target = this.nextTarget(index);
    if (target === undefined) return;
    seat.target = (target + 1) % this.seats.length;
    const recipient = this.seats[target]!;
    if (recipient.garbageId === 0xffffffff) { this.disconnect(target, "Garbage sequence exhausted", now); return; }
    // Cancellation already happened on the sending toy. One recipient per attack.
    this.queue(target, { type: 7, round, a, b: this.random32() % this.policy.garbageColumns, c: ++recipient.garbageId }, now);
  }

  disconnect(index: number, reason: string, now: number): void {
    const seat = this.seats[index];
    if (!seat?.connected) return;
    seat.connected = false; seat.reason = reason; seat.outbox = [];
    if (this.phase === "preparing" || this.phase === "countdown" || this.phase === "lobby") {
      this.abort("A toy disconnected during preparation; return to Online for a new match", now); return;
    }
    if (this.phase === "playing") this.eliminate(index, now);
    if (this.phase === "playing" || this.phase === "round-result") {
      const connected = this.seats.flatMap((s, i) => s.connected ? [i] : []);
      if (connected.length <= 1) {
        this.winner = connected[0] ?? 255; this.phase = "results";
        this.reason = "Match ended by disconnect";
        this.broadcast({ type: 10, round: this.round, a: this.winner, b: this.wins, c: 0 }, now);
      }
    }
  }

  tick(now: number): void {
    for (const [index, seat] of this.seats.entries())
      if (seat.connected && seat.endpoint.error) this.disconnect(index, seat.endpoint.error, now);
    this.flush(now);
    if (this.phase === "preparing") {
      if (this.seats.every(s => !s.connected || s.prepared) && this.drained()) {
        this.phase = "countdown"; this.deadline = now + COUNTDOWN_MS;
      } else if (now >= this.deadline) this.abort("A toy did not confirm the round seed", now);
    } else if (this.phase === "countdown" && now >= this.deadline + PREPARE_MS) {
      this.abort("A toy stopped acknowledging the countdown", now);
    } else if (this.phase === "countdown" && now >= this.deadline && this.drained()) {
      this.phase = "playing";
      this.broadcast({ type: 5, round: this.round, a: this.seed, b: 0, c: 0 }, now);
      // Frozen indices include forfeited seats. Clients reset all bits on START.
      const absent = this.seats.findIndex(s => !s.connected);
      if (absent >= 0) this.broadcast({ type: 8, round: this.round, a: absent, b: this.alive, c: 0 }, now);
    } else if (this.phase === "playing" && this.settleAt !== undefined && now >= this.settleAt) {
      this.finishRound(now);
    } else if (this.phase === "round-result" && now >= this.deadline + PREPARE_MS) {
      this.abort("A toy stopped acknowledging the round result", now);
    } else if (this.phase === "round-result" && now >= this.deadline && this.drained()) {
      if (this.finishAfterResult) this.phase = "results";
      else this.beginRound(now);
    }
    this.flush(now);
  }

  private random32(): number { return (this.random() >>> 0) || 1; }
  private nextTarget(index: number): number | undefined {
    if (!(this.alive & (1 << index))) return;
    const seat = this.seats[index]!;
    for (let offset = 0; offset < this.seats.length; offset++) {
      const candidate = (seat.target + offset) % this.seats.length;
      if (candidate !== index && (this.alive & (1 << candidate))) return candidate;
    }
  }
  private beginRound(now: number): void {
    this.round++; this.seed = this.random32(); this.phase = "preparing";
    this.deadline = now + PREPARE_MS; this.settleAt = undefined; this.winner = undefined;
    this.alive = this.seats.reduce((mask, s, i) => mask | (s.connected ? 1 << i : 0), 0);
    for (const [index, seat] of this.seats.entries()) {
      seat.prepared = false; seat.garbageId = 0;
      seat.target = (index + 1 + this.seed % (this.seats.length - 1)) % this.seats.length;
      if (seat.connected) this.queue(index, { type: 4, round: this.round, a: this.seed,
        b: this.seats.length | (index << 8), c: this.wins }, now);
    }
  }
  private eliminate(index: number, now: number): void {
    if (!(this.alive & (1 << index))) return;
    this.alive &= ~(1 << index);
    this.broadcast({ type: 8, round: this.round, a: index, b: this.alive, c: 0 }, now);
    if ((this.alive & (this.alive - 1)) === 0 && this.settleAt === undefined) this.settleAt = now + SETTLE_MS;
  }
  private finishRound(now: number): void {
    this.winner = this.alive ? 31 - Math.clz32(this.alive) : 255;
    if (this.winner !== 255) this.wins = (this.wins + 2 ** (2 * this.winner)) >>> 0;
    this.finishAfterResult = this.winner !== 255 && ((this.wins >>> (2 * this.winner)) & 3) >= 2;
    this.phase = "round-result"; this.deadline = now + RESULT_MS;
    this.broadcast({ type: 9, round: this.round, a: this.winner, b: this.wins, c: 0 }, now);
    if (this.finishAfterResult) this.broadcast({ type: 10, round: this.round, a: this.winner, b: this.wins, c: 0 }, now);
  }
  private abort(reason: string, now: number): void {
    if (this.phase === "aborted") return;
    this.phase = "aborted"; this.reason = reason;
    this.broadcast({ type: 12, round: this.round, a: 0, b: 0, c: 0 }, now);
  }
  private drained(): boolean { return this.seats.every(s => !s.connected || (!s.outbox.length && !s.endpoint.pending)); }
  private broadcast(message: Tet3Message, now: number): void {
    for (let i = 0; i < this.seats.length; i++) this.queue(i, message, now);
  }
  private queue(index: number, message: Tet3Message, now: number): void {
    const seat = this.seats[index]!;
    if (!seat.connected) return;
    // Only unsent alive snapshots may coalesce. C54C validates loser index then
    // stores the entire mask; there is no per-loser side effect. Never mutate
    // endpoint/in-flight messages, attacks, START, GO or results.
    const old = message.type === 8 ? seat.outbox.findIndex(m => m.type === 8 && m.round === message.round) : -1;
    if (old >= 0) { seat.outbox[old] = message; return; }
    if (seat.outbox.length >= OUTBOX_LIMIT) { this.disconnect(index, "Toy cannot keep up with match traffic", now); return; }
    seat.outbox.push(message);
  }
  private flush(now: number): void {
    for (const [index, seat] of this.seats.entries()) {
      // Leave transport headroom. Waiting status can coalesce in our bounded
      // outbox; one slow toy never blocks another toy's send queue.
      while (seat.connected && seat.outbox.length && seat.endpoint.pending < 4) {
        const m = seat.outbox.shift()!;
        if (!seat.endpoint.enqueue(m.type, m.round, m.a, m.b, m.c)) {
          this.disconnect(index, seat.endpoint.error ?? "Toy send rejected", now); break;
        }
      }
    }
  }
}
